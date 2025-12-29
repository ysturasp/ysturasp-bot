import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { getLessonTypeName } from '../helpers/schedule-formatter';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly scheduleService: ScheduleService,
    @InjectBot() private readonly bot: Telegraf,
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
        if (day.info.date === todayStr) {
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
        if (diffMinutes === sub.notifyMinutes) {
          await this.sendNotification(sub, lesson);
        }
      }
    }
  }

  private async sendNotification(sub: Subscription, lesson: any) {
    const message = `🔔 Напоминание!
    
🕐 Через ${sub.notifyMinutes} минут (${lesson.timeRange})
📚 ${lesson.lessonName}
📝 ${getLessonTypeName(lesson.type)}
${lesson.auditoryName ? `🏛 ${lesson.auditoryName}` : ''}
${lesson.teacherName ? `👨‍🏫 ${lesson.teacherName}` : ''}`;

    try {
      await this.bot.telegram.sendMessage(sub.user.chatId, message);
    } catch (e) {
      this.logger.error(`Failed to send notification to ${sub.id}`, e);
    }
  }
}
