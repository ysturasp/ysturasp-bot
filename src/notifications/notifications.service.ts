import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import Redis from 'ioredis';
import { Subscription } from '../database/entities/subscription.entity';
import { BotEvent } from '../database/entities/bot-event.entity';
import { User } from '../database/entities/user.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { getLessonTypeName } from '../helpers/schedule-formatter';
import { formatMinutes } from '../helpers/time-parser';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(BotEvent)
    private readonly botEventRepository: Repository<BotEvent>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly scheduleService: ScheduleService,
    @InjectBot() private readonly bot: Telegraf,
    private readonly analyticsService: AnalyticsService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  private normalizeGroupName(groupName: string): string {
    return groupName.trim().toUpperCase();
  }

  private isRunning = false;

  @Cron('0 * * * * *')
  async handleCron() {
    if (this.isRunning) {
      this.logger.debug('Previous cron job still running, skipping...');
      return;
    }
    this.isRunning = true;
    let sentCount = 0;
    let errorCount = 0;

    try {
      const subs = await this.subscriptionRepository.find({
        where: { isActive: true },
        relations: ['user'],
      });
      if (subs.length === 0) return;

      const groups = [...new Set(subs.map((s) => s.groupName))];

      for (const groupName of groups) {
        try {
          const normalizedGroupName = this.normalizeGroupName(groupName);
          const schedule = await this.scheduleService.getSchedule(groupName);
          if (!schedule) continue;

          const count = await this.checkGroupSchedule(
            normalizedGroupName,
            schedule,
            subs.filter((s) => s.groupName === groupName),
          );
          sentCount += count;
        } catch (e) {
          errorCount++;
          this.logger.error(`Error processing group ${groupName}`, e);
        }
      }

      if (sentCount > 0 || errorCount > 0) {
        this.logger.log(
          `Notification check run complete. Sent: ${sentCount}, Errors: ${errorCount}`,
        );
      }
    } finally {
      this.isRunning = false;
    }
  }

  private getMoscowDateString(dateInput: Date | string): string {
    const date = new Date(dateInput);
    const mskDate = new Date(date.getTime() + 3 * 60 * 60 * 1000);
    return mskDate.toISOString().split('T')[0];
  }

  private async checkGroupSchedule(
    groupName: string,
    schedule: any,
    groupSubs: Subscription[],
  ): Promise<number> {
    const now = new Date();
    const todayStr = this.getMoscowDateString(now);

    let lessons = [];
    let sentCount = 0;

    for (const week of schedule.items) {
      for (const day of week.days) {
        const dayDate = this.getMoscowDateString(day.info.date);

        if (dayDate === todayStr) {
          lessons = day.lessons;
          break;
        }
      }
    }

    if (lessons.length === 0) return 0;

    for (const lesson of lessons) {
      const startAt = new Date(lesson.startAt);
      const diffMs = startAt.getTime() - now.getTime();
      const diffMinutes = Math.round(diffMs / 60000);

      for (const sub of groupSubs) {
        if (
          diffMinutes <= sub.notifyMinutes &&
          diffMinutes > sub.notifyMinutes - 2
        ) {
          const lessonKey = `${lesson.startAt}:${lesson.lessonName}`;
          const redisKey = `notif:lesson:${sub.userId}:${lessonKey}:${todayStr}`;
          const alreadySent = await this.redis.get(redisKey);

          if (!alreadySent) {
            await this.sendNotification(sub, lesson, groupName);
            await this.redis.set(redisKey, '1', 'EX', 60 * 60 * 24);
            sentCount++;
          }
        }
      }
    }
    return sentCount;
  }

  private async sendNotification(
    sub: Subscription,
    lesson: any,
    groupName: string,
  ) {
    const message = `🔔 Напоминание! (${groupName})
    
🕐 Через ${formatMinutes(sub.notifyMinutes)} (${lesson.timeRange})
📚 ${lesson.lessonName}
📝 ${getLessonTypeName(lesson.type)}
${lesson.auditoryName ? `🏛 ${lesson.auditoryName}` : ''}
${lesson.teacherName ? `👨‍🏫 ${lesson.teacherName}` : ''}`.trim();

    try {
      await this.bot.telegram.sendMessage(sub.user.chatId, message);

      await this.analyticsService.track({
        chatId: sub.user.chatId,
        userId: sub.user.id,
        eventType: 'notification:lesson',
        payload: {
          lessonName: lesson.lessonName,
          groupName: groupName,
          lessonType: lesson.type,
          timeRange: lesson.timeRange,
          notifyMinutes: sub.notifyMinutes,
          auditoryName: lesson.auditoryName,
          teacherName: lesson.teacherName,
        },
      });

      this.logger.log(
        `Notification sent to ${sub.user.chatId} for ${groupName}: ${lesson.lessonName}`,
      );
    } catch (e: any) {
      this.logger.error(
        `Failed to send notification to ${sub.user.chatId} for ${groupName}`,
        e,
      );

      if (
        e.response?.error_code === 403 ||
        e.message?.includes('bot was blocked')
      ) {
        if (!sub.user.isBlocked) {
          sub.user.isBlocked = true;
          await this.userRepository.save(sub.user);
          this.logger.log(
            `User ${sub.user.chatId} marked as blocked due to 403 error`,
          );
        }
      }
    }
  }
}
