import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { Exam } from '../../database/entities/exam.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { formatSchedule } from '../../helpers/schedule-formatter';

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
  ) {}

  async handleExams(ctx: Context, userId: number): Promise<void> {
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: userId } },
    });
    if (!subs.length) {
      await ctx.reply(
        '❌ У вас нет активных подписок. Используйте /subscribe чтобы добавить группу.',
      );
      return;
    }

    const formatDate = (isoDate: string): string => {
      const date = new Date(isoDate);
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
    };

    let foundAny = false;
    let msg = '';
    for (const sub of subs) {
      const normalizedGroupName = sub.groupName.trim().toLowerCase();
      const exams = await this.examRepository
        .createQueryBuilder('exam')
        .where('LOWER(exam.groupName) = :groupName', {
          groupName: normalizedGroupName,
        })
        .orderBy('exam.date', 'ASC')
        .getMany();

      if (!exams.length) {
        continue;
      }
      foundAny = true;
      msg += `🎓 <b>Экзамены для группы ${sub.groupName}</b>\n\n`;
      for (const exam of exams) {
        msg += `📚 ${exam.lessonName}\n🕐 ${formatDate(exam.date)}\n${exam.teacherName ? '👨‍🏫 ' + exam.teacherName + '\n' : ''}${exam.auditoryName ? '🏛 ' + exam.auditoryName + '\n' : ''}\n`;
      }
      msg += '\n';
    }
    if (foundAny) {
      await ctx.reply(msg.trim(), { parse_mode: 'HTML' });
    } else {
      await ctx.reply('Экзамены для ваших групп не найдены.');
    }
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
      [
        Markup.button.callback(
          '« Назад к выбору дня',
          `quick_view:${groupName}`,
        ),
      ],
    ]);

    await ctx.editMessageText(message, keyboard);
  }

  async handleViewWeek(ctx: Context, groupName: string): Promise<void> {
    await ctx.answerCbQuery();

    const schedule = await this.scheduleService.getSchedule(groupName);
    const message = formatSchedule(schedule, 'week', groupName);

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '« Назад к выбору дня',
          `quick_view:${groupName}`,
        ),
      ],
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
          '📅 Посмотреть расписание',
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
    userId: number,
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
        await ctx.reply(
          '❌ У вас нет активных подписок. Используйте /subscribe чтобы добавить группу.',
        );
        return;
      }
      groupName = sub.groupName;
    }

    const schedule = await this.scheduleService.getSchedule(groupName);
    const message = formatSchedule(schedule, dayOffset, groupName);
    await ctx.reply(message);
  }
}
