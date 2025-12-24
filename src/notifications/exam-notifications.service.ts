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
  ) {}

  @Cron('*/5 * * * *')
  async checkExams() {
    this.logger.debug('Checking for exam notifications...');
    const subs = await this.subscriptionRepository.find({
      where: { isActive: true },
      relations: ['user'],
    });
    if (subs.length === 0) return;
    const groups = [...new Set(subs.map((s) => s.groupName))];
    for (const groupName of groups) {
      try {
        const schedule = await this.scheduleService.getSchedule(groupName);
        if (!schedule) continue;
        await this.checkGroupExams(
          groupName,
          schedule,
          subs.filter((s) => s.groupName === groupName),
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
  ) {
    const exams = this.extractExams(schedule);
    for (const exam of exams) {
      const existing = await this.examRepository.findOne({
        where: { groupName, lessonName: exam.lessonName, date: exam.date },
      });
      if (!existing) {
        const saved = await this.examRepository.save({ ...exam, groupName });
        await this.notifySubscribers(groupSubs, saved, 'new');
      } else if (
        existing.teacherName !== exam.teacherName ||
        existing.auditoryName !== exam.auditoryName ||
        existing.timeRange !== exam.timeRange
      ) {
        await this.examRepository.update(existing.id, exam);
        await this.notifySubscribers(
          groupSubs,
          { ...existing, ...exam },
          'changed',
        );
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
    exam: Exam,
    mode: 'new' | 'changed',
  ) {
    const msg =
      mode === 'new'
        ? this.buildExamNewMessage(exam)
        : this.buildExamChangedMessage(exam);
    for (const sub of subs) {
      try {
        await this.bot.telegram.sendMessage(sub.user.chatId, msg, {
          parse_mode: 'HTML',
        });
      } catch (e) {
        this.logger.error(`Failed to send exam notification to ${sub.id}`, e);
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

    return `🎓 <b>Добавлен новый экзамен</b>\n\n📚 ${exam.lessonName}\n🕐 ${formatDate(exam.date)}\n${exam.teacherName ? '👨‍🏫 ' + exam.teacherName + '\n' : ''}${exam.auditoryName ? '🏛 ' + exam.auditoryName + '\n' : ''}`;
  }

  private buildExamChangedMessage(exam: Exam): string {
    const formatDate = (isoDate: string): string => {
      const date = new Date(isoDate);
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
    };

    return `✏️ <b>Изменение экзамена</b>\n\n📚 ${exam.lessonName}\n🕐 ${formatDate(exam.date)}\n${exam.teacherName ? '👨‍🏫 ' + exam.teacherName + '\n' : ''}${exam.auditoryName ? '🏛 ' + exam.auditoryName + '\n' : ''}`;
  }
}
