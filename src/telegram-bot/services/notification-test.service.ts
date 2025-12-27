import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import { Subscription } from '../../database/entities/subscription.entity';
import { ScheduleService } from '../../schedule/schedule.service';

@Injectable()
export class NotificationTestService {
  private readonly logger = new Logger(NotificationTestService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly scheduleService: ScheduleService,
  ) {}

  async handleTestNotify(ctx: Context, userId: string) {
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: userId }, isActive: true },
    });

    if (subs.length === 0) {
      await ctx.reply(
        'У вас нет активных подписок. Используйте /subscribe чтобы подписаться на уведомления.',
      );
      return;
    }

    for (const sub of subs) {
      try {
        const schedule = await this.scheduleService.getSchedule(sub.groupName);
        if (!schedule) continue;

        const now = new Date();
        let closestLesson = null;
        let closestDate = null;
        let minTimeDiff = Infinity;

        for (const week of schedule.items) {
          for (const day of week.days) {
            const dayDate = new Date(day.info.date);
            if (dayDate < now) continue;

            for (const lesson of day.lessons || []) {
              const lessonStart = new Date(lesson.startAt);
              const timeDiff = lessonStart.getTime() - now.getTime();

              if (timeDiff > 0 && timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestLesson = lesson;
                closestDate = dayDate;
              }
            }
          }
        }

        if (closestLesson && closestDate) {
          const formattedDate = closestDate.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
          const daysOfWeek = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
          const dayOfWeek = daysOfWeek[closestDate.getDay()];

          const testMsg =
            '🔔 ТЕСТОВОЕ Напоминание о занятии:\n\n' +
            `👨‍💻 Группа: ${sub.groupName}\n` +
            `📅 Дата: ${dayOfWeek} (${formattedDate})\n` +
            `📚 Предмет: ${closestLesson.lessonName}\n` +
            `📝 Тип: ${this.getLessonTypeName(closestLesson.type)}\n` +
            `🕐 Время: ${closestLesson.timeRange}\n` +
            (closestLesson.teacherName
              ? `👨‍🏫 Преподаватель: ${closestLesson.teacherName}\n`
              : '') +
            (closestLesson.auditoryName
              ? `🏛 Аудитория: ${closestLesson.auditoryName}\n`
              : '') +
            `\n⚠️ Это тестовое уведомление. Реальные уведомления будут приходить за ${sub.notifyMinutes} минут до начала занятия.`;

          await ctx.reply(testMsg);
        } else {
          await ctx.reply(
            `❌ Не удалось найти предстоящие пары в расписании группы ${sub.groupName}`,
          );
        }
      } catch (e) {
        this.logger.error(
          `Ошибка при получении расписания группы ${sub.groupName}`,
          e,
        );
        await ctx.reply(
          `❌ Ошибка при получении расписания группы ${sub.groupName}`,
        );
      }
    }

    await ctx.reply('Тестовые уведомления отправлены для всех ваших подписок.');
  }

  private getLessonTypeName(type: number): string {
    const LESSON_TYPES: Record<number, string> = {
      0: 'Нет типа',
      1: 'Курсовой проект',
      2: 'Лекция',
      3: 'Экзамен',
      4: 'Практика',
      5: 'Консультация',
      6: 'Лекция + Практика',
      7: 'Дифференцированный зачет',
      8: 'Лабораторная работа',
      9: 'Библиотека',
      10: 'Лекция + Лабораторная работа',
      11: 'Организационное собрание',
      12: 'Не поддерживается',
      256: 'Экзамен',
    };
    return LESSON_TYPES[type] || '';
  }
}
