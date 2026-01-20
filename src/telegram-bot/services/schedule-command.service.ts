import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { Exam } from '../../database/entities/exam.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { formatSchedule } from '../../helpers/schedule-formatter';
import { StatisticsService } from './statistics.service';

@Injectable()
export class ScheduleCommandService {
  private readonly logger = new Logger(ScheduleCommandService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Exam)
    private readonly examRepository: Repository<Exam>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly scheduleService: ScheduleService,
    private readonly statisticsService: StatisticsService,
  ) {}

  async handleExams(ctx: Context, userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      await ctx.reply('❌ Пользователь не найден.');
      return;
    }

    const subs = await this.subscriptionRepository.find({
      where: { user: { id: userId } },
    });

    const subGroupNames = new Set(subs.map((s) => s.groupName.toUpperCase()));
    const preferredGroupOnly =
      user.preferredGroup &&
      !subGroupNames.has(user.preferredGroup.toUpperCase());

    if (!subs.length && !user.preferredGroup) {
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🔔 Подписаться на уведомления',
            'open_subscribe:main',
          ),
        ],
        [
          Markup.button.callback(
            '📅 Выбрать группу для просмотра',
            'open_select_group:main',
          ),
        ],
      ]);
      await ctx.reply(
        '❌ У вас нет активных подписок.\n\nВы можете подписаться на уведомления или выбрать группу для просмотра расписания.',
        keyboard,
      );
      return;
    }

    const formatDate = (isoDate: string): string => {
      const date = new Date(isoDate);
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Moscow',
      });
    };

    let foundAny = false;
    let msg = '';

    for (const sub of subs) {
      const normalizedGroupName = sub.groupName.trim().toUpperCase();
      const exams = await this.examRepository
        .createQueryBuilder('exam')
        .where('UPPER(exam.groupName) = :groupName', {
          groupName: normalizedGroupName,
        })
        .orderBy('exam.date', 'ASC')
        .getMany();

      if (!exams.length) {
        continue;
      }
      foundAny = true;
      msg += `🎓 <b>Экзамены для группы ${sub.groupName}</b>\n\n`;

      const institute = await this.statisticsService.getInstituteByGroup(
        sub.groupName,
      );

      for (const exam of exams) {
        msg += `📚 ${exam.lessonName}\n🕐 ${formatDate(exam.date)}\n${exam.teacherName ? '👨‍🏫 ' + exam.teacherName + '\n' : ''}${exam.auditoryName ? '🏛 ' + exam.auditoryName + '\n' : ''}`;

        if (institute) {
          try {
            const matchingDiscipline =
              await this.statisticsService.findMatchingDiscipline(
                institute,
                exam.lessonName,
              );

            if (matchingDiscipline) {
              const statistics =
                await this.statisticsService.getSubjectStatistics(
                  institute,
                  matchingDiscipline,
                );

              if (statistics && statistics.totalCount > 0) {
                const avgScore = statistics.average.toFixed(2);
                const statsUrl = this.statisticsService.getStatisticsUrl(
                  institute,
                  matchingDiscipline,
                );
                msg += `📊 Средний балл: <a href="${statsUrl}">${avgScore} (${statistics.totalCount} оценок)</a>\n`;
              }
            }
          } catch (error) {
            this.logger.error(
              `Error fetching statistics for ${exam.lessonName}:`,
              error,
            );
          }
        } else {
          this.logger.debug(`No institute found for group: ${sub.groupName}`);
        }

        msg += '\n';
      }
      msg += '\n';
    }

    if (preferredGroupOnly) {
      const groupName = user.preferredGroup;
      const normalizedGroupName = groupName.trim().toUpperCase();

      const schedule = await this.scheduleService.getSchedule(groupName);
      const exams = this.extractExamsFromSchedule(schedule);

      if (exams.length > 0) {
        exams.sort((a, b) => {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          return dateA - dateB;
        });

        foundAny = true;
        msg += `🎓 <b>Экзамены для группы ${groupName}</b>\n\n`;

        const institute =
          await this.statisticsService.getInstituteByGroup(groupName);

        for (const exam of exams) {
          msg += `📚 ${exam.lessonName}\n🕐 ${formatDate(exam.date)}\n${exam.teacherName ? '👨‍🏫 ' + exam.teacherName + '\n' : ''}${exam.auditoryName ? '🏛 ' + exam.auditoryName + '\n' : ''}`;

          if (institute) {
            try {
              const matchingDiscipline =
                await this.statisticsService.findMatchingDiscipline(
                  institute,
                  exam.lessonName,
                );

              if (matchingDiscipline) {
                const statistics =
                  await this.statisticsService.getSubjectStatistics(
                    institute,
                    matchingDiscipline,
                  );

                if (statistics && statistics.totalCount > 0) {
                  const avgScore = statistics.average.toFixed(2);
                  const statsUrl = this.statisticsService.getStatisticsUrl(
                    institute,
                    matchingDiscipline,
                  );
                  msg += `📊 Средний балл: <a href="${statsUrl}">${avgScore} (${statistics.totalCount} оценок)</a>\n`;
                }
              }
            } catch (error) {
              this.logger.error(
                `Error fetching statistics for ${exam.lessonName}:`,
                error,
              );
            }
          } else {
            this.logger.debug(`No institute found for group: ${groupName}`);
          }

          msg += '\n';
        }
        msg += '\n';
      }
    }

    if (foundAny) {
      await ctx.reply(msg.trim(), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } else {
      await ctx.reply('Экзамены для ваших групп не найдены.');
    }
  }

  private extractExamsFromSchedule(schedule: any): Array<{
    lessonName: string;
    teacherName?: string;
    auditoryName?: string;
    date: string;
    timeRange?: string;
    type: number;
  }> {
    const exams: Array<{
      lessonName: string;
      teacherName?: string;
      auditoryName?: string;
      date: string;
      timeRange?: string;
      type: number;
    }> = [];
    if (!schedule || !schedule.items) return exams;
    for (const week of schedule.items) {
      for (const day of week.days) {
        for (const lesson of day.lessons || []) {
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

  async handleQuickView(ctx: Context, groupName: string): Promise<void> {
    await ctx.answerCbQuery();

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📅 Сегодня', `view_day:${groupName}:0`)],
      [Markup.button.callback('📅 Завтра', `view_day:${groupName}:1`)],
      [Markup.button.callback('📅 Неделя', `view_week:${groupName}`)],
      [Markup.button.callback('« Назад', `back_to_group:${groupName}`)],
    ]);

    await ctx.editMessageText(
      `📋 Расписание для группы ${groupName}:`,
      keyboard,
    );
  }

  async handleViewDay(
    ctx: Context,
    groupName: string,
    dayOffset: number,
  ): Promise<void> {
    await ctx.answerCbQuery();

    const schedule = await this.scheduleService.getSchedule(groupName);
    const message = formatSchedule(schedule, dayOffset, groupName);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', `quick_view:${groupName}`)],
    ]);

    await ctx.editMessageText(message, keyboard);
  }

  async handleViewWeek(
    ctx: Context,
    groupName: string,
    weekOffset = 0,
  ): Promise<void> {
    await ctx.answerCbQuery();

    const schedule = await this.scheduleService.getSchedule(groupName);
    const message = formatSchedule(schedule, 'week', groupName, weekOffset);

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '👈 Предыдущая',
          `view_week:${groupName}:${weekOffset - 1}`,
        ),
        Markup.button.callback(
          'Следующая 👉',
          `view_week:${groupName}:${weekOffset + 1}`,
        ),
      ],
      [Markup.button.callback('« Назад', `quick_view:${groupName}`)],
    ]);

    await ctx.editMessageText(message, keyboard);
  }

  async handleBackToGroup(
    ctx: Context,
    user: User,
    groupName: string,
  ): Promise<void> {
    user.state = null;
    user.stateData = null;
    await ctx.answerCbQuery();

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '🔔 Подписаться на уведомления',
          `quick_sub:${groupName}`,
        ),
      ],
      [
        Markup.button.callback(
          '📌 Только просмотр кнопками',
          `quick_select_group:${groupName}`,
        ),
      ],
      [
        Markup.button.callback(
          '📅 Быстрый просмотр',
          `quick_view:${groupName}`,
        ),
      ],
    ]);

    await ctx.editMessageText(
      `✅ Нашёл группу <b>${groupName}</b>!\n\nЧто вы хотите сделать?`,
      { parse_mode: 'HTML', ...keyboard },
    );
  }

  async handleScheduleRequest(
    ctx: Context,
    userId: string,
    dayOffset: number | 'week',
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      await ctx.reply('❌ Пользователь не найден.');
      return;
    }

    let groupName: string | undefined = user.preferredGroup;

    if (!groupName) {
      const sub = await this.subscriptionRepository.findOne({
        where: { user: { id: userId } },
        order: { id: 'DESC' },
      });
      if (!sub) {
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🔔 Подписаться на уведомления',
              'open_subscribe:main',
            ),
          ],
          [
            Markup.button.callback(
              '📅 Выбрать группу для просмотра',
              'open_select_group:main',
            ),
          ],
        ]);
        await ctx.reply(
          '❌ У вас нет активных подписок.\n\nВы можете подписаться на уведомления или выбрать группу для просмотра расписания.',
          keyboard,
        );
        return;
      }
      groupName = sub.groupName;
    }

    const schedule = await this.scheduleService.getSchedule(groupName);

    if (dayOffset === 'week') {
      const weekOffset = 0;
      const message = formatSchedule(schedule, 'week', groupName, weekOffset);
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '👈 Предыдущая',
            `view_week:${groupName}:${weekOffset - 1}`,
          ),
          Markup.button.callback(
            'Следующая 👉',
            `view_week:${groupName}:${weekOffset + 1}`,
          ),
        ],
      ]);
      await ctx.reply(message, keyboard);
      return;
    }

    const message = formatSchedule(schedule, dayOffset, groupName);
    await ctx.reply(message);
  }
}
