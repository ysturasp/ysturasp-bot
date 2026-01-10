import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { getGroupScheduleKey, getGroupsListKey } from '../helpers/redis-keys';

const groupLocks: Record<string, Promise<any> | null> = {};

let _concurrentRequests = 0;
const MAX_CONCURRENT = 5;
const requestQueue: Array<() => void> = [];

async function runWithLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (_concurrentRequests < MAX_CONCURRENT) {
    _concurrentRequests++;
    try {
      return await fn();
    } finally {
      _concurrentRequests--;
      const next = requestQueue.shift();
      if (next) next();
    }
  }

  return new Promise<T>((resolve, reject) => {
    requestQueue.push(async () => {
      _concurrentRequests++;
      try {
        const res = await fn();
        resolve(res);
      } catch (e) {
        reject(e);
      } finally {
        _concurrentRequests--;
        const next = requestQueue.shift();
        if (next) next();
      }
    });
  });
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  private readonly baseUrl = 'https://gg-api.ystuty.ru/s/schedule/v1';

  constructor(
    private readonly httpService: HttpService,
    @Inject('REDIS') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  async getGroups(): Promise<string[]> {
    const cacheKey = getGroupsListKey();
    try {
      const cachedRaw = await this.redis.get(cacheKey);
      if (cachedRaw) {
        try {
          const parsed = JSON.parse(cachedRaw) as string[];
          if (parsed && parsed.length) return parsed;
        } catch (e) {
          this.logger.debug('Failed to parse groups cache', e);
        }
      }

      const token = this.configService.get<string>('ACCESS_TOKEN');
      const { data } = await firstValueFrom(
        this.httpService.get<any>(
          `${this.baseUrl}/schedule/actual_groups`,
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
        ),
      );

      const rawItems = data.items || [];
      let items: string[] = [];
      if (rawItems.length && typeof rawItems[0] === 'string') {
        items = rawItems as string[];
      } else {
        items = rawItems.flatMap((section: any) => {
          if (Array.isArray(section.groups)) return section.groups as string[];
          if (Array.isArray(section.items)) return section.items as string[];
          return [] as string[];
        });
      }

      try {
        await this.redis.set(cacheKey, JSON.stringify(items), 'EX', 3600);
      } catch (e) {
        this.logger.debug('Failed to set groups cache', e);
      }

      return items;
    } catch (error) {
      this.logger.error('Error fetching groups', error);
      return [];
    }
  }

  async getSchedule(groupName: string): Promise<any> {
    const cacheKey = getGroupScheduleKey(groupName);

    if (groupLocks[groupName]) {
      return groupLocks[groupName];
    }

    groupLocks[groupName] = (async () => {
      try {
        const cachedRaw = await this.redis.get(cacheKey);
        if (cachedRaw) {
          try {
            const cached = JSON.parse(cachedRaw);
            this.logger.log(`Cache hit for group: ${groupName}`);
            return cached;
          } catch (e) {
            this.logger.debug('Failed to parse schedule cache', e);
          }
        }

        const perform = async () => {
          const maxRetries = 3;
          let attempt = 0;
          let backoffMs = 5000;

          while (true) {
            try {
              this.logger.log(
                `Fetching schedule for group: ${groupName} (attempt ${attempt + 1})`,
              );
              const token = this.configService.get<string>('ACCESS_TOKEN');
              const { data } = await firstValueFrom(
                this.httpService.get(
                  `${this.baseUrl}/schedule/group/${encodeURIComponent(
                    groupName,
                  )}`,
                  token
                    ? { headers: { Authorization: `Bearer ${token}` } }
                    : undefined,
                ),
              );

              const ttl = this.configService.get<number>('CACHE_TTL', 1200);
              try {
                await this.redis.set(cacheKey, JSON.stringify(data), 'EX', ttl);
              } catch (e) {
                this.logger.debug('Failed to set schedule cache', e);
              }
              return data;
            } catch (err) {
              attempt++;
              if (err instanceof AxiosError && err.response?.status === 429) {
                if (attempt > maxRetries) throw err;
                this.logger.warn(
                  `Received 429 for ${groupName}, backing off ${backoffMs}ms (attempt ${attempt})`,
                );
                await new Promise((r) => setTimeout(r, backoffMs));
                backoffMs *= 2;
                continue;
              }
              throw err;
            }
          }
        };
        const data = await runWithLimit(() => perform());
        return data;
      } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 404) {
          return null;
        }
        this.logger.error(`Error fetching schedule for ${groupName}`, error);
        throw error;
      } finally {
        groupLocks[groupName] = null;
      }
    })();

    return groupLocks[groupName];
  }
}
