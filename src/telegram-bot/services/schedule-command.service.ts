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
import { normalizeAudienceName } from '../../helpers/group-normalizer';

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
    const message = formatSchedule(
      schedule,
      dayOffset,
      groupName,
      0,
      'student',
    );

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
    const message = formatSchedule(
      schedule,
      'week',
      groupName,
      weekOffset,
      'student',
    );

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
      const message = formatSchedule(
        schedule,
        'week',
        groupName,
        weekOffset,
        'student',
      );
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

    const message = formatSchedule(
      schedule,
      dayOffset,
      groupName,
      0,
      'student',
    );
    await ctx.reply(message);
  }

  async handleQuickSelectTeacher(
    ctx: Context,
    teacherId: number,
    query?: string,
  ): Promise<void> {
    await ctx.answerCbQuery();
    const teachers = await this.scheduleService.getTeachers();
    const teacher = teachers.find((t) => t.id === teacherId);
    if (!teacher) {
      await ctx.editMessageText('❌ Преподаватель не найден.');
      return;
    }

    const rows = [
      [
        Markup.button.callback(
          '📅 Сегодня',
          query
            ? `view_teacher_day:${teacher.id}:0:${query}`
            : `view_teacher_day:${teacher.id}:0`,
        ),
        Markup.button.callback(
          '📅 Завтра',
          query
            ? `view_teacher_day:${teacher.id}:1:${query}`
            : `view_teacher_day:${teacher.id}:1`,
        ),
      ],
      [
        Markup.button.callback(
          '📅 Неделя',
          query
            ? `view_teacher_week:${teacher.id}:0:${query}`
            : `view_teacher_week:${teacher.id}:0`,
        ),
      ],
    ];

    if (query) {
      rows.push([
        Markup.button.callback('« Назад к списку', `teacher_search:${query}`),
      ]);
    }

    const keyboard = Markup.inlineKeyboard(rows);

    await ctx.editMessageText(
      `👨‍🏫 Выбрано: <b>${teacher.name}</b>\nПоказать расписание?`,
      { parse_mode: 'HTML', ...keyboard },
    );
  }

  async handleTeacherSearch(
    ctx: Context,
    query: string,
    page = 0,
  ): Promise<void> {
    const isCallback = !!ctx.callbackQuery;
    if (isCallback) await ctx.answerCbQuery();

    const teachers = await this.scheduleService.getTeachers();
    const matchingTeachers = teachers.filter((t) =>
      t.name.toLowerCase().includes(query.toLowerCase().trim()),
    );

    if (matchingTeachers.length === 0) {
      const msg = '❌ Преподаватели не найдены.';
      if (isCallback) await ctx.editMessageText(msg);
      else await ctx.reply(msg);
      return;
    }

    const pageSize = 10;
    const totalPages = Math.ceil(matchingTeachers.length / pageSize);
    const start = page * pageSize;
    const end = start + pageSize;
    const pagedTeachers = matchingTeachers.slice(start, end);

    const buttons = pagedTeachers.map((t) => [
      Markup.button.callback(t.name, `quick_select_teacher:${t.id}:${query}`),
    ]);

    const navRow: any[] = [];
    if (page > 0) {
      navRow.push(
        Markup.button.callback(
          '👈 Пред.',
          `teacher_search:${query}:${page - 1}`,
        ),
      );
    }
    if (page < totalPages - 1) {
      navRow.push(
        Markup.button.callback(
          'След. 👉',
          `teacher_search:${query}:${page + 1}`,
        ),
      );
    }
    if (navRow.length > 0) {
      buttons.push(navRow);
    }

    const promptParts: string[] = [];
    const q = query.toLowerCase().trim();
    let hasSurname = false;
    let hasName = false;
    let hasPatronymic = false;

    for (const t of matchingTeachers) {
      const parts = t.name.toLowerCase().split(' ');
      if (parts[0] && parts[0].includes(q)) hasSurname = true;
      if (parts[1] && parts[1].includes(q)) hasName = true;
      if (parts[2] && parts[2].includes(q)) hasPatronymic = true;
    }

    if (hasSurname) promptParts.push('фамилией');
    if (hasName) promptParts.push('именем');
    if (hasPatronymic) promptParts.push('отчеством');

    const promptType =
      promptParts.length > 0 ? promptParts.join(' или ') : 'данными';

    const paginationText =
      totalPages > 1 ? ` (стр. ${page + 1}/${totalPages})` : '';
    const message = `❓ Нашёл несколько преподавателей со схожей <b>${promptType}</b>. Пожалуйста, выберите нужного${paginationText}:`;

    if (isCallback) {
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    }
  }

  async handleTeacherDay(
    ctx: Context,
    teacherId: number,
    dayOffset: number,
    query?: string,
  ): Promise<void> {
    await ctx.answerCbQuery();
    const schedule = await this.scheduleService.getTeacherSchedule(teacherId);
    if (!schedule) {
      await ctx.editMessageText('❌ Расписание преподавателя не найдено.');
      return;
    }
    const message = formatSchedule(schedule, dayOffset, '', 0, 'teacher');
    const backAction = query
      ? `quick_select_teacher:${teacherId}:${query}`
      : `quick_select_teacher:${teacherId}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', backAction)],
    ]);
    await ctx.editMessageText(message, keyboard);
  }

  async handleTeacherWeek(
    ctx: Context,
    teacherId: number,
    weekOffset = 0,
    query?: string,
  ): Promise<void> {
    await ctx.answerCbQuery();
    const schedule = await this.scheduleService.getTeacherSchedule(teacherId);
    if (!schedule) {
      await ctx.editMessageText('❌ Расписание преподавателя не найдено.');
      return;
    }
    const message = formatSchedule(schedule, 'week', '', weekOffset, 'teacher');
    const backAction = query
      ? `quick_select_teacher:${teacherId}:${query}`
      : `quick_select_teacher:${teacherId}`;

    const prevAction = query
      ? `view_teacher_week:${teacherId}:${weekOffset - 1}:${query}`
      : `view_teacher_week:${teacherId}:${weekOffset - 1}`;
    const nextAction = query
      ? `view_teacher_week:${teacherId}:${weekOffset + 1}:${query}`
      : `view_teacher_week:${teacherId}:${weekOffset + 1}`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('👈 Предыдущая', prevAction),
        Markup.button.callback('Следующая 👉', nextAction),
      ],
      [Markup.button.callback('« Назад', backAction)],
    ]);
    await ctx.editMessageText(message, keyboard);
  }

  async handleAudienceDay(
    ctx: Context,
    audienceId: string,
    dayOffset: number,
    query?: string,
  ): Promise<void> {
    await ctx.answerCbQuery();
    const schedule = await this.scheduleService.getAudienceSchedule(audienceId);
    if (!schedule) {
      await ctx.editMessageText('❌ Расписание аудитории не найдено.');
      return;
    }
    const message = formatSchedule(schedule, dayOffset, '', 0, 'audience');
    const backAction = query
      ? `quick_select_audience:${audienceId}:${query}`
      : `quick_select_audience:${audienceId}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', backAction)],
    ]);
    await ctx.editMessageText(message, keyboard);
  }

  async handleAudienceWeek(
    ctx: Context,
    audienceId: string,
    weekOffset = 0,
    query?: string,
  ): Promise<void> {
    await ctx.answerCbQuery();
    const schedule = await this.scheduleService.getAudienceSchedule(audienceId);
    if (!schedule) {
      await ctx.editMessageText('❌ Расписание аудитории не найдено.');
      return;
    }
    const message = formatSchedule(
      schedule,
      'week',
      '',
      weekOffset,
      'audience',
    );
    const backAction = query
      ? `quick_select_audience:${audienceId}:${query}`
      : `quick_select_audience:${audienceId}`;

    const prevAction = query
      ? `view_audience_week:${audienceId}:${weekOffset - 1}:${query}`
      : `view_audience_week:${audienceId}:${weekOffset - 1}`;
    const nextAction = query
      ? `view_audience_week:${audienceId}:${weekOffset + 1}:${query}`
      : `view_audience_week:${audienceId}:${weekOffset + 1}`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('👈 Предыдущая', prevAction),
        Markup.button.callback('Следующая 👉', nextAction),
      ],
      [Markup.button.callback('« Назад', backAction)],
    ]);
    await ctx.editMessageText(message, keyboard);
  }

  async handleQuickSelectAudience(
    ctx: Context,
    audienceId: string,
    query?: string,
  ): Promise<void> {
    await ctx.answerCbQuery();
    const audiences = await this.scheduleService.getAudiences();
    const audience = audiences.find((a) => String(a.id) === String(audienceId));
    if (!audience) {
      await ctx.editMessageText('❌ Аудитория не найденa.');
      return;
    }

    const rows = [
      [
        Markup.button.callback(
          '📅 Сегодня',
          query
            ? `view_audience_day:${audience.id}:0:${query}`
            : `view_audience_day:${audience.id}:0`,
        ),
        Markup.button.callback(
          '📅 Завтра',
          query
            ? `view_audience_day:${audience.id}:1:${query}`
            : `view_audience_day:${audience.id}:1`,
        ),
      ],
      [
        Markup.button.callback(
          '📅 Неделя',
          query
            ? `view_audience_week:${audience.id}:0:${query}`
            : `view_audience_week:${audience.id}:0`,
        ),
      ],
    ];

    if (query) {
      rows.push([
        Markup.button.callback('« Назад к списку', `audience_search:${query}`),
      ]);
    }

    const keyboard = Markup.inlineKeyboard(rows);

    await ctx.editMessageText(
      `🏛 Выбрано: <b>${audience.name}</b>\nПоказать расписание?`,
      { parse_mode: 'HTML', ...keyboard },
    );
  }

  async handleAudienceSearch(
    ctx: Context,
    query: string,
    page = 0,
  ): Promise<void> {
    const isCallback = !!ctx.callbackQuery;
    if (isCallback) await ctx.answerCbQuery();

    const audiences = await this.scheduleService.getAudiences();
    const cleanQuery = normalizeAudienceName(query);
    const matchingAudiences = audiences.filter((a) => {
      const cleanName = normalizeAudienceName(a.name);
      return cleanName.includes(cleanQuery);
    });

    if (matchingAudiences.length === 0) {
      const msg = '❌ Аудитории не найдены.';
      if (isCallback) await ctx.editMessageText(msg);
      else await ctx.reply(msg);
      return;
    }

    const pageSize = 10;
    const totalPages = Math.ceil(matchingAudiences.length / pageSize);
    const start = page * pageSize;
    const end = start + pageSize;
    const pagedAudiences = matchingAudiences.slice(start, end);

    const buttons = pagedAudiences.map((a) => [
      Markup.button.callback(a.name, `quick_select_audience:${a.id}:${query}`),
    ]);

    const navRow: any[] = [];
    if (page > 0) {
      navRow.push(
        Markup.button.callback(
          '👈 Пред.',
          `audience_search:${query}:${page - 1}`,
        ),
      );
    }
    if (page < totalPages - 1) {
      navRow.push(
        Markup.button.callback(
          'След. 👉',
          `audience_search:${query}:${page + 1}`,
        ),
      );
    }
    if (navRow.length > 0) {
      buttons.push(navRow);
    }

    const promptParts: string[] = [];
    const q = cleanQuery.toLowerCase().trim();

    const hasBuilding = /[а-яёa-z]/.test(q);
    const hasNumber = /\d/.test(q);

    if (hasBuilding) promptParts.push('корпусу');
    if (hasNumber) promptParts.push('номеру');

    const promptType =
      promptParts.length > 0 ? promptParts.join(' и ') : 'данным';

    const paginationText =
      totalPages > 1 ? ` (стр. ${page + 1}/${totalPages})` : '';
    const message = `❓ Нашёл несколько аудиторий по <b>${promptType}</b>. Пожалуйста, выберите нужную${paginationText}:`;

    if (isCallback) {
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    }
  }

  async handleQuickViewAudience(
    ctx: Context,
    audienceId: string,
  ): Promise<void> {
    await this.handleQuickSelectAudience(ctx, audienceId);
  }
}
