import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface UptimeRobotMonitor {
  monitorId: number;
  createdAt: string;
  statusClass: 'success' | 'danger' | 'warning';
  name: string;
  url: string | null;
  type: string;
  groupId: number;
  groupName: string;
  dailyRatios: Array<{
    date: string;
    ratio: string;
    label: string;
    color: string;
  }>;
  '30dRatio': {
    ratio: string;
    label: string;
    color: string;
  };
  '90dRatio': {
    ratio: string;
    label: string;
    color: string;
  };
  ratio: {
    ratio: string;
    label: string;
    color: string;
  };
  hasIncidentComments: boolean;
  lastDowntime?: {
    date: string;
    duration: number;
    reason: string;
  } | null;
}

export interface UptimeRobotResponse {
  status: string;
  data: UptimeRobotMonitor[];
  statistics: {
    uptime: {
      l1: { label: string; ratio: string };
      l7: { label: string; ratio: string };
      l30: { label: string; ratio: string };
      l90: { label: string; ratio: string };
    };
    latest_downtime: string | null;
    counts: {
      up: number;
      down: number;
      paused: number;
      total: number;
    };
    count_result: string;
  };
}

@Injectable()
export class UptimeRobotService {
  private readonly logger = new Logger(UptimeRobotService.name);
  private readonly apiUrl = 'https://stats.uptimerobot.com/api/getMonitorList/COz2FUGsub';

  constructor(private readonly httpService: HttpService) {}

  async checkServiceStatus(): Promise<UptimeRobotResponse | null> {
    try {
      const timestamp = Date.now();
      const url = `${this.apiUrl}?page=1&_=${timestamp}`;

      const response = await firstValueFrom(
        this.httpService.get<UptimeRobotResponse>(url, {
          headers: {
            accept: 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'cache-control': 'no-cache',
            referer: 'https://stats.uptimerobot.com/COz2FUGsub',
            'x-requested-with': 'XMLHttpRequest',
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Error checking service status:', error);
      if (error instanceof Error) {
        this.logger.error('Error message:', error.message);
        this.logger.error('Error stack:', error.stack);
      }
      return null;
    }
  }

  getDownServices(data: UptimeRobotResponse): UptimeRobotMonitor[] {
    return data.data.filter((monitor) => monitor.statusClass === 'danger');
  }

  getUpServices(data: UptimeRobotResponse): UptimeRobotMonitor[] {
    return data.data.filter((monitor) => monitor.statusClass === 'success');
  }
}

