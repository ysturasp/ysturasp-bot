import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import Redis from 'ioredis';
import { Subscription } from '../database/entities/subscription.entity';
import { BotEvent } from '../database/entities/bot-event.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { getLessonTypeName } from '../helpers/schedule-formatter';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(BotEvent)
    private readonly botEventRepository: Repository<BotEvent>,
    private readonly scheduleService: ScheduleService,
    @InjectBot() private readonly bot: Telegraf,
    private readonly analyticsService: AnalyticsService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  private normalizeGroupName(groupName: string): string {
    return groupName.trim().toUpperCase();
  }

  @Cron('0 * * * * *')
  async handleCron() {
    this.logger.debug('Checking for notifications...');

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

        await this.checkGroupSchedule(
          normalizedGroupName,
          schedule,
          subs.filter((s) => s.groupName === groupName),
        );
      } catch (e) {
        this.logger.error(`Error processing group ${groupName}`, e);
      }
    }
  }

  private async checkGroupSchedule(
    groupName: string,
    schedule: any,
    groupSubs: Subscription[],
  ) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    let lessons = [];

    for (const week of schedule.items) {
      for (const day of week.days) {
        const dayDate =
          typeof day.info.date === 'string'
            ? day.info.date.split('T')[0]
            : new Date(day.info.date).toISOString().split('T')[0];

        if (dayDate === todayStr) {
          lessons = day.lessons;
          break;
        }
      }
    }

    if (lessons.length === 0) return;

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
          }
        }
      }
    }
  }

  private async sendNotification(
    sub: Subscription,
    lesson: any,
    groupName: string,
  ) {
    const message = `🔔 Напоминание! (${groupName})
    
🕐 Через ${sub.notifyMinutes} минут (${lesson.timeRange})
📚 ${lesson.lessonName}
📝 ${getLessonTypeName(lesson.type)}
${lesson.auditoryName ? `🏛 ${lesson.auditoryName}` : ''}
${lesson.teacherName ? `👨‍🏫 ${lesson.teacherName}` : ''}`.trim();

    try {
      await this.bot.telegram.sendMessage(sub.user.chatId, message);

      await this.botEventRepository.save({
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
        source: 'telegram',
      });

      await this.analyticsService.track({
        chatId: sub.user.chatId,
        userId: sub.user.id,
        eventType: 'notification:lesson',
        payload: { lessonName: lesson.lessonName, groupName },
      });

      this.logger.log(
        `Notification sent to ${sub.user.chatId} for ${groupName}: ${lesson.lessonName}`,
      );
    } catch (e) {
      this.logger.error(
        `Failed to send notification to ${sub.user.chatId} for ${groupName}`,
        e,
      );
    }
  }
}
