import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  private readonly API_BASE = 'https://gg-api.ystuty.ru/s/schedule/v1';

  constructor(private readonly httpService: HttpService) {}

  async getGroups(): Promise<string[]> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ items: string[] }>(`${this.API_BASE}/groups`),
      );
      return data.items;
    } catch (error) {
      this.logger.error('Error fetching groups', error);
      return [];
    }
  }

  async getSchedule(groupName: string): Promise<any> {
    try {
      const encodedName = encodeURIComponent(groupName);
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.API_BASE}/schedule/group/${encodedName}`),
      );
      return data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 404) {
        return null;
      }
      this.logger.error(`Error fetching schedule for ${groupName}`, error);
      throw error;
    }
  }
}
