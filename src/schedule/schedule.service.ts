import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

const groupLocks: Record<string, Promise<any> | null> = {};

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  private readonly baseUrl = 'https://gg-api.ystuty.ru/s/schedule/v1';

  constructor(
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getGroups(): Promise<string[]> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ items: string[] }>(`${this.baseUrl}/groups`),
      );
      return data.items;
    } catch (error) {
      this.logger.error('Error fetching groups', error);
      return [];
    }
  }

  async getSchedule(groupName: string): Promise<any> {
    const cacheKey = `schedule:${groupName}`;

    if (groupLocks[groupName]) {
      return groupLocks[groupName];
    }

    groupLocks[groupName] = (async () => {
      try {
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          this.logger.log(`Cache hit for group: ${groupName}`);
          return cached;
        }

        this.logger.log(`Fetching schedule for group: ${groupName}`);
        const { data } = await firstValueFrom(
          this.httpService.get(
            `${this.baseUrl}/schedule/group/${encodeURIComponent(groupName)}`,
          ),
        );

        await this.cacheManager.set(cacheKey, data);

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
