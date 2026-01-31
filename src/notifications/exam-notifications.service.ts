import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { Exam } from '../database/entities/exam.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { getLessonTypeName } from '../helpers/schedule-formatter';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class ExamNotificationsService {
  private readonly logger = new Logger(ExamNotificationsService.name);

  constructor(
    @InjectRepository(Exam)
    private readonly examRepository: Repository<Exam>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly scheduleService: ScheduleService,
    @InjectBot() private readonly bot: Telegraf,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private normalizeGroupName(groupName: string): string {
    return groupName.trim().toUpperCase();
  }

  @Cron('*/5 * * * *')
  async checkExams() {
    this.logger.debug('Checking for exam notifications...');
    const subs = await this.subscriptionRepository.find({
      where: { isActive: true },
      relations: ['user'],
    });
    if (subs.length === 0) return;
    const groups = [...new Set(subs.map((s) => s.groupName))];
    const sentNotifications = new Set<string>();
    for (const groupName of groups) {
      try {
        const normalizedGroupName = this.normalizeGroupName(groupName);
        const schedule = await this.scheduleService.getSchedule(groupName);
        if (!schedule) continue;
        await this.checkGroupExams(
          normalizedGroupName,
          schedule,
          subs.filter((s) => s.groupName === groupName),
          sentNotifications,
        );
      } catch (e) {
        this.logger.error(`Error processing group ${groupName}`, e);
      }
    }
  }

  private async checkGroupExams(
    groupName: string,
    schedule: any,
    groupSubs: Subscription[],
    sentNotifications: Set<string>,
  ) {
    const exams = this.extractExams(schedule);
    for (const exam of exams) {
      const existing = await this.examRepository.findOne({
        where: { groupName, lessonName: exam.lessonName },
      });

      if (!existing) {
        const saved = await this.examRepository.save({ ...exam, groupName });
        const key = `${groupName}|${saved.lessonName}|new`;
        if (!sentNotifications.has(key)) {
          sentNotifications.add(key);
          await this.notifySubscribers(groupSubs, saved, 'new');
        }
      } else {
        if (
          existing.date !== exam.date ||
          existing.teacherName !== exam.teacherName ||
          existing.auditoryName !== exam.auditoryName ||
          existing.timeRange !== exam.timeRange
        ) {
          await this.examRepository.update(existing.id, { ...exam, groupName });
          const payload = {
            ...existing,
            ...exam,
            groupName,
            prev: existing,
          } as Exam & {
            prev?: Partial<Exam>;
          };
          const key = `${groupName}|${payload.lessonName}|changed`;
          if (!sentNotifications.has(key)) {
            sentNotifications.add(key);
            await this.notifySubscribers(groupSubs, payload, 'changed');
          }
        }
      }
    }
  }

  private extractExams(schedule: any): Partial<Exam>[] {
    const exams: Partial<Exam>[] = [];
    if (!schedule || !schedule.items) return exams;
    for (const week of schedule.items) {
      for (const day of week.days) {
        for (const lesson of day.lessons) {
          if (lesson.type === 3 || lesson.type === 256) {
            exams.push({
              lessonName: lesson.lessonName,
              teacherName: lesson.teacherName,
              auditoryName: lesson.auditoryName,
              date: day.info.date,
              timeRange: lesson.timeRange,
              type: lesson.type,
            });
          }
        }
      }
    }
    return exams;
  }

  private async notifySubscribers(
    subs: Subscription[],
    exam: Exam & { prev?: Partial<Exam> },
    mode: 'new' | 'changed',
  ) {
    const msg =
      mode === 'new'
        ? this.buildExamNewMessage(exam)
        : this.buildExamChangedMessage(exam);
    const sent = new Set<string>();
    for (const sub of subs) {
      const chatId = String(sub.user?.chatId || sub.user?.chatId);
      if (sent.has(chatId)) continue;
      sent.add(chatId);
      try {
        await this.bot.telegram.sendMessage(chatId, msg, {
          parse_mode: 'HTML',
        });
        await this.analyticsService.track({
          chatId,
          userId: sub.user?.id,
          eventType:
            mode === 'new'
              ? 'notification:exam_new'
              : 'notification:exam_changed',
          payload: { examId: exam.id },
        });
      } catch (e) {
        this.logger.error(`Failed to send exam notification to ${chatId}`, e);
      }
    }
  }

  private buildExamNewMessage(exam: Exam): string {
    const formatDate = (isoDate: string): string => {
      const date = new Date(isoDate);
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
    };

    return `🎓 <b>Добавлен новый экзамен</b> (${exam.groupName})\n\n📚 ${exam.lessonName}\n🕐 ${formatDate(exam.date)}\n${exam.teacherName ? '👨‍🏫 ' + exam.teacherName + '\n' : ''}${exam.auditoryName ? '🏛 ' + exam.auditoryName + '\n' : ''}`;
  }

  private buildExamChangedMessage(
    exam: Exam & { prev?: Partial<Exam> },
  ): string {
    const formatDate = (isoDate: string): string => {
      if (!isoDate) return '';
      const date = new Date(isoDate);
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
    };

    const prev = exam.prev || {};
    const diffLine = (label: string, prevVal?: string, newVal?: string) => {
      if (prevVal && newVal && prevVal !== newVal) {
        return `${label} <s>${prevVal}</s> → ${newVal}`;
      } else if (newVal) {
        return `${label} ${newVal}`;
      }
      return '';
    };

    const lines = [
      `✏️ <b>Изменение экзамена</b> (${exam.groupName})\n`,
      '',
      diffLine('📚', prev.lessonName, exam.lessonName),
      diffLine(
        '🕐',
        prev.date ? formatDate(prev.date) : undefined,
        formatDate(exam.date),
      ),
      diffLine('👨‍🏫', prev.teacherName, exam.teacherName),
      diffLine('🏛', prev.auditoryName, exam.auditoryName),
      diffLine('⏰', prev.timeRange, exam.timeRange),
    ].filter(Boolean);
    return lines.join('\n');
  }
}
