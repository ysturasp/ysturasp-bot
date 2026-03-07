import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { UptimeRobotService, UptimeRobotMonitor } from './uptimerobot.service';

@Injectable()
export class UptimeRobotMonitorService {
  private readonly logger = new Logger(UptimeRobotMonitorService.name);
  private isRunning = false;

  constructor(
    private readonly uptimeRobotService: UptimeRobotService,
    @InjectBot() private readonly bot: Telegraf,
    private readonly configService: ConfigService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  @Cron('*/5 * * * *')
  async checkServiceStatuses() {
    if (this.isRunning) {
      this.logger.debug('Previous status check still running, skipping...');
      return;
    }

    this.isRunning = true;
    try {
      const data = await this.uptimeRobotService.checkServiceStatus();
      if (!data || data.status !== 'ok') {
        this.logger.warn('Failed to fetch UptimeRobot data or invalid status');
        return;
      }

      await this.processStatusChanges(data.data);
    } catch (error) {
      this.logger.error('Error in checkServiceStatuses', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async processStatusChanges(monitors: UptimeRobotMonitor[]) {
    for (const monitor of monitors) {
      const redisKey = `uptimerobot:status:${monitor.monitorId}`;
      const previousStatus = await this.redis.get(redisKey);
      const currentStatus = monitor.statusClass;

      if (previousStatus !== currentStatus) {
        await this.handleStatusChange(monitor, previousStatus, currentStatus);
        await this.redis.set(redisKey, currentStatus, 'EX', 7 * 24 * 60 * 60);
      }
    }
  }

  private async handleStatusChange(
    monitor: UptimeRobotMonitor,
    previousStatus: string | null,
    currentStatus: string,
  ) {
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');
    if (!adminChatId) {
      this.logger.warn('ADMIN_CHAT_ID not configured');
      return;
    }

    try {
      if (currentStatus === 'danger') {
        await this.sendDownNotification(adminChatId, monitor);
      } else if (currentStatus === 'success' && previousStatus === 'danger') {
        await this.sendUpNotification(adminChatId, monitor);
      }
    } catch (error) {
      this.logger.error(
        `Error sending notification for monitor ${monitor.monitorId}`,
        error,
      );
    }
  }

  private async sendDownNotification(
    adminChatId: string,
    monitor: UptimeRobotMonitor,
  ) {
    const lastDowntime = monitor.lastDowntime;
    const downtimeInfo = lastDowntime
      ? `\n⏰ <b>Последний отвал:</b> ${this.formatDate(lastDowntime.date)}\n⏱ <b>Длительность:</b> ${this.formatDuration(lastDowntime.duration)} сек`
      : '';

    const message = `🔴 <b>Сервис недоступен</b>\n\n` +
      `📛 <b>Название:</b> ${this.escapeHtml(monitor.name)}\n` +
      `🔧 <b>Тип:</b> ${this.escapeHtml(monitor.type)}\n` +
      `📊 <b>Uptime (30 дней):</b> ${monitor['30dRatio'].ratio}%\n` +
      `📊 <b>Uptime (90 дней):</b> ${monitor['90dRatio'].ratio}%` +
      downtimeInfo;

    await this.bot.telegram.sendMessage(adminChatId, message, {
      parse_mode: 'HTML',
    });

    this.logger.log(`Sent down notification for monitor: ${monitor.name}`);
  }

  private async sendUpNotification(
    adminChatId: string,
    monitor: UptimeRobotMonitor,
  ) {
    const message = `✅ <b>Сервис восстановлен</b>\n\n` +
      `📛 <b>Название:</b> ${this.escapeHtml(monitor.name)}\n` +
      `🔧 <b>Тип:</b> ${this.escapeHtml(monitor.type)}\n` +
      `📊 <b>Uptime (30 дней):</b> ${monitor['30dRatio'].ratio}%\n` +
      `📊 <b>Uptime (90 дней):</b> ${monitor['90dRatio'].ratio}%`;

    await this.bot.telegram.sendMessage(adminChatId, message, {
      parse_mode: 'HTML',
    });

    this.logger.log(`Sent up notification for monitor: ${monitor.name}`);
  }

  private formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0
        ? `${minutes}м ${remainingSeconds}с`
        : `${minutes}м`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}ч ${remainingMinutes}м` : `${hours}ч`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

