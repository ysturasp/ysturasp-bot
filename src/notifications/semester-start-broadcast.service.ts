import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import Redis from 'ioredis';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { StatisticsService } from '../telegram-bot/services/statistics.service';
import { ScheduleService } from '../schedule/schedule.service';

@Injectable()
export class SemesterStartBroadcastService {
  private readonly logger = new Logger(SemesterStartBroadcastService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly statisticsService: StatisticsService,
    private readonly scheduleService: ScheduleService,
    @InjectBot() private readonly bot: Telegraf,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Europe/Moscow' })
  async sendSemesterStartMessage() {
    if (!this.isSemesterStart()) {
      return;
    }

    const semesterKey = this.getSemesterKey();
    const alreadySent = await this.redis.get(semesterKey);

    if (alreadySent) {
      return;
    }

    this.logger.log('Sending semester start messages...');

    const users = await this.getUsersToNotify();

    if (users.length === 0) {
      this.logger.log('No users to notify');
      return;
    }

    let success = 0;
    let blocked = 0;
    let errors = 0;
    const blockedUsers: string[] = [];
    const errorMessages: string[] = [];

    for (const user of users) {
      try {
        const message = await this.generateSemesterStartMessage(user);
        await this.bot.telegram.sendMessage(user.chatId, message, {
          parse_mode: 'HTML',
        });
        success++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (e: any) {
        if (
          e.response?.error_code === 403 ||
          e.message?.includes('bot was blocked')
        ) {
          blocked++;
          blockedUsers.push(user.username || user.chatId);
          if (!user.isBlocked) {
            user.isBlocked = true;
            await this.userRepository.save(user);
            this.logger.log(
              `User ${user.chatId} marked as blocked due to 403 error`,
            );
          }
        } else {
          errors++;
          const errorMsg = `${user.username || user.chatId}: ${e.message || 'Unknown error'}`;
          errorMessages.push(errorMsg);
          this.logger.error(`Failed to send message to user ${user.chatId}`, e);
        }
      }
    }

    this.logger.log(
      `Semester start broadcast completed. Success: ${success}, Blocked: ${blocked}, Errors: ${errors}`,
    );

    await this.redis.set(semesterKey, '1', 'EX', 60 * 60 * 24 * 200);

    await this.sendStatsToAdmins(
      success,
      blocked,
      blockedUsers,
      errors,
      errorMessages,
    );
  }

  private isSemesterStart(): boolean {
    const now = new Date();
    const currentMonth = now.getMonth();

    const SPRING_SEMESTER_START_MONTH = 1;
    const AUTUMN_SEMESTER_START_MONTH = 8;

    if (
      currentMonth !== SPRING_SEMESTER_START_MONTH &&
      currentMonth !== AUTUMN_SEMESTER_START_MONTH
    ) {
      return false;
    }

    const year = now.getFullYear();
    const firstMondayDate = this.getFirstMondayOfMonth(year, currentMonth);

    const weekStart = new Date(firstMondayDate);
    const weekEnd = new Date(firstMondayDate);
    weekEnd.setDate(weekEnd.getDate() + 6);

    return now >= weekStart && now <= weekEnd;
  }

  private getFirstMondayOfMonth(year: number, month: number): Date {
    const date = new Date(year, month, 1);
    const day = date.getDay();
    const diff = day === 0 ? 6 : day - 1;

    date.setDate(date.getDate() + (diff === 0 ? 0 : 7 - diff));
    return date;
  }

  private getSemesterKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const semester = month >= 0 && month <= 6 ? 'spring' : 'autumn';

    return `semester_start_broadcast:${year}:${semester}`;
  }

  private async getUsersToNotify(): Promise<User[]> {
    const subscriptionsUsers = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.user', 'user')
      .where('sub.isActive = :isActive', { isActive: true })
      .getMany();

    const userIds = new Set(subscriptionsUsers.map((s) => s.user.id));

    const usersWithReferredGroup = await this.userRepository
      .createQueryBuilder('user')
      .where('user.preferredGroup IS NOT NULL')
      .andWhere('user.preferredGroup != :empty', { empty: '' })
      .getMany();

    const referredGroupUserIds = usersWithReferredGroup.map((u) => u.id);
    referredGroupUserIds.forEach((id) => userIds.add(id));

    const uniqueUsers = await this.userRepository.find({
      where: userIds.size > 0 ? Array.from(userIds).map((id) => ({ id })) : [],
    });

    return uniqueUsers;
  }

  private async sendStatsToAdmins(
    success: number,
    blocked: number,
    blockedUsers: string[],
    errors: number,
    errorMessages: string[],
  ) {
    try {
      const admins = await this.userRepository.find({
        where: { isAdmin: true },
      });

      if (admins.length === 0) {
        this.logger.warn('No admins found to send stats');
        return;
      }

      let statsMessage = `📊 <b>Статистика рассылки начала семестра</b>\n\n`;
      statsMessage += `✅ Успешно отправлено: <b>${success}</b>\n`;

      if (blocked > 0) {
        statsMessage += `🚫 Заблокировали бота: <b>${blocked}</b>\n`;
        if (blockedUsers.length > 0 && blockedUsers.length <= 10) {
          statsMessage += `\nЗаблокировавшие:\n${blockedUsers.map((u) => `  • ${u}`).join('\n')}\n`;
        } else if (blockedUsers.length > 10) {
          statsMessage += `\nПервые 10 заблокировавших:\n${blockedUsers
            .slice(0, 10)
            .map((u) => `  • ${u}`)
            .join('\n')}\n`;
          statsMessage += `  ...и еще ${blockedUsers.length - 10}\n`;
        }
      }

      if (errors > 0) {
        statsMessage += `\n❌ Ошибки при отправке: <b>${errors}</b>\n`;
        if (errorMessages.length > 0 && errorMessages.length <= 5) {
          statsMessage += `\nОшибки:\n${errorMessages.map((e) => `  • ${e}`).join('\n')}\n`;
        } else if (errorMessages.length > 5) {
          statsMessage += `\nПервые 5 ошибок:\n${errorMessages
            .slice(0, 5)
            .map((e) => `  • ${e}`)
            .join('\n')}\n`;
          statsMessage += `  ...и еще ${errorMessages.length - 5}\n`;
        }
      }

      statsMessage += `\n📅 Время рассылки: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;

      for (const admin of admins) {
        try {
          await this.bot.telegram.sendMessage(admin.chatId, statsMessage, {
            parse_mode: 'HTML',
          });
        } catch (e) {
          this.logger.error(`Failed to send stats to admin ${admin.chatId}`, e);
        }
      }

      this.logger.log(`Stats sent to ${admins.length} admin(s)`);
    } catch (e) {
      this.logger.error('Error sending stats to admins', e);
    }
  }

  private async generateSemesterStartMessage(user: User): Promise<string> {
    let subjectsInfo = '';

    try {
      const groupName =
        user.preferredGroup || (await this.getUserSubscribedGroup(user.id));

      if (groupName) {
        subjectsInfo = await this.getSubjectsInfoForGroup(groupName);
      }
    } catch (e) {
      this.logger.error(`Error getting subjects info for user ${user.id}`, e);
    }

    return `привет, спишь? 😴

семестр начинается! 🎉 пора возвращаться к учебе

${subjectsInfo}
всем успехов! 💪📚

ваш ysturasp 🙀`;
  }

  private async getUserSubscribedGroup(userId: string): Promise<string | null> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId, isActive: true },
    });
    return subscription?.groupName || null;
  }

  private async getSubjectsInfoForGroup(groupName: string): Promise<string> {
    try {
      const schedule = await this.scheduleService.getSchedule(groupName);

      if (!schedule || !schedule.items || schedule.items.length === 0) {
        return '';
      }

      const institute =
        await this.statisticsService.getInstituteByGroup(groupName);

      if (!institute) {
        return '';
      }

      const semesterDates = this.getCurrentSemesterDates();

      const subjectsInSchedule = this.extractSubjectsFromSchedule(
        schedule,
        semesterDates,
      );

      if (subjectsInSchedule.length === 0) {
        return '';
      }

      const disciplines =
        await this.statisticsService.getDisciplines(institute);

      const subjectsData: Array<{
        name: string;
        average?: number;
        totalCount?: number;
        url?: string;
      }> = [];

      for (const subject of subjectsInSchedule) {
        const matchedDiscipline =
          await this.statisticsService.findMatchingDiscipline(
            institute,
            subject,
          );

        if (matchedDiscipline) {
          const stats = await this.statisticsService.getSubjectStatistics(
            institute,
            matchedDiscipline,
          );
          if (stats && stats.totalCount > 0) {
            const url = this.statisticsService.getStatisticsUrl(
              institute,
              matchedDiscipline,
            );
            subjectsData.push({
              name: subject,
              average: Number(stats.average.toFixed(2)),
              totalCount: stats.totalCount,
              url: url,
            });
          } else {
            subjectsData.push({ name: subject });
          }
        } else {
          subjectsData.push({ name: subject });
        }
      }

      if (subjectsData.length === 0) {
        return '';
      }

      subjectsData.sort((a, b) => a.name.localeCompare(b.name));

      let subjectsText = `<b>в этом семестре тебя (${groupName}) ожидают эти предметы:</b>\n\n`;
      for (const subject of subjectsData) {
        if (subject.average && subject.url) {
          subjectsText += `📖 <b>${subject.name}</b> - средний балл: <a href="${subject.url}">${subject.average} (${subject.totalCount} оценок)</a>\n`;
        } else {
          subjectsText += `📖 <b>${subject.name}</b>\n`;
        }
      }

      return subjectsText;
    } catch (e) {
      this.logger.error(
        `Error getting subjects info for group ${groupName}`,
        e,
      );
      return '';
    }
  }

  private getCurrentSemesterDates(): { start: Date; end: Date } {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const SPRING_SEMESTER_START_MONTH = 1;
    const AUTUMN_SEMESTER_START_MONTH = 8;
    const SEMESTER_WEEKS_COUNT = 18;

    if (currentMonth >= 0 && currentMonth <= 6) {
      const start = this.getFirstMondayOfMonth(
        currentYear,
        SPRING_SEMESTER_START_MONTH,
      );
      const end = new Date(start);
      end.setDate(start.getDate() + (SEMESTER_WEEKS_COUNT - 1) * 7 + 6);
      return { start, end };
    } else {
      const start = this.getFirstMondayOfMonth(
        currentYear,
        AUTUMN_SEMESTER_START_MONTH,
      );
      const end = new Date(start);
      end.setDate(start.getDate() + (SEMESTER_WEEKS_COUNT - 1) * 7 + 6);
      return { start, end };
    }
  }

  private extractSubjectsFromSchedule(
    schedule: any,
    semesterDates: { start: Date; end: Date },
  ): string[] {
    const subjects = new Set<string>();

    if (!schedule.items || !Array.isArray(schedule.items)) {
      return Array.from(subjects);
    }

    for (const item of schedule.items) {
      if (item.days && Array.isArray(item.days)) {
        for (const day of item.days) {
          if (day.info && day.info.date) {
            const dayDate = new Date(day.info.date);
            if (
              dayDate >= semesterDates.start &&
              dayDate <= semesterDates.end
            ) {
              if (day.lessons && Array.isArray(day.lessons)) {
                for (const lesson of day.lessons) {
                  if (lesson.lessonName) {
                    subjects.add(lesson.lessonName);
                  }
                }
              }
            }
          }
        }
      }
    }

    return Array.from(subjects);
  }
}
