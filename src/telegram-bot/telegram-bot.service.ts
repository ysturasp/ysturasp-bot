import {
  Action,
  Command,
  Ctx,
  Hears,
  On,
  Start,
  Update,
} from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { formatSchedule } from '../helpers/schedule-formatter';

@Update()
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly scheduleService: ScheduleService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const chat = ctx.chat;
    const user = ctx.from;

    if (!user || !chat) return;

    let dbUser = await this.userRepository.findOne({
      where: { chatId: String(chat.id) },
    });
    if (!dbUser) {
      dbUser = this.userRepository.create({
        chatId: String(chat.id),
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        isAdmin: String(chat.id) === process.env.ADMIN_CHAT_ID,
      });
      await this.userRepository.save(dbUser);
    }

    const message = `👋 Привет, ${user.first_name}! Я бот для расписания занятий.

📅 Используйте кнопки ниже для быстрого доступа к расписанию!

/support - Отправить проблему
/suggestion - Оставить предложение
/subscribe - Подписаться на уведомления
/subscriptions - Мои подписки
/exams - Экзамены`;

    await ctx.reply(message, this.getMainKeyboard());
  }

  @Command('menu')
  async onMenu(@Ctx() ctx: Context) {
    await ctx.reply('📋 Меню:', this.getMainKeyboard());
  }

  @Command('subscribe')
  async onSubscribe(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    await this.userRepository.save(user);
    await ctx.reply('Введите название группы (например, ЦИС-33):');
  }

  @Command('unsubscribe')
  async onUnsubscribe(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id } },
    });

    if (subs.length === 0) {
      await ctx.reply('У вас нет активных подписок.');
      return;
    }

    const buttons = subs.map((sub) => [
      Markup.button.callback(`❌ ${sub.groupName}`, `unsubscribe:${sub.id}`),
    ]);

    await ctx.reply(
      'Выберите подписку для удаления:',
      Markup.inlineKeyboard(buttons),
    );
  }

  @Action(/^unsubscribe:(\d+)$/)
  async onUnsubscribeAction(@Ctx() ctx: Context) {
    // @ts-ignore
    const subId = parseInt(ctx.match[1]);
    await this.subscriptionRepository.delete(subId);
    await ctx.answerCbQuery('Подписка удалена');
    await ctx.editMessageText('✅ Подписка успешно удалена.');
  }

  @Command('subscriptions')
  async onSubscriptions(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id } },
    });

    if (subs.length === 0) {
      await ctx.reply('У вас нет активных подписок.');
      return;
    }

    let msg = '📋 Ваши подписки:\n\n';
    subs.forEach((sub) => {
      msg += `🎓 Группа: ${sub.groupName}\n⏰ Уведомление: за ${sub.notifyMinutes} мин\n\n`;
    });

    await ctx.reply(msg);
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    // @ts-ignore
    const text = ctx.message.text;
    const user = await this.getUser(ctx);

    if (text === '📅 Сегодня' || text === '/today') {
      return this.handleScheduleRequest(ctx, user, 0);
    }
    if (text === '📅 Завтра' || text === '/tomorrow') {
      return this.handleScheduleRequest(ctx, user, 1);
    }
    if (text === '📅 Неделя' || text === '/week') {
      return this.handleScheduleRequest(ctx, user, 'week');
    }

    if (user.state === 'WAITING_GROUP_SUBSCRIBE') {
      const groupName = text.trim();
      const schedule = await this.scheduleService.getSchedule(groupName);

      if (!schedule) {
        await ctx.reply(
          `❌ Группа "${groupName}" не найдена. Попробуйте еще раз (например, ЦИС-33):`,
        );
        return;
      }

      user.state = 'WAITING_NOTIFY_TIME';
      user.stateData = { pendingGroup: groupName };
      await this.userRepository.save(user);

      await ctx.reply(
        `✅ Группа ${groupName} найдена!\n\nЗа сколько минут до начала занятия присылать уведомление? (Введите число, например 30)`,
      );
    } else if (user.state === 'WAITING_NOTIFY_TIME') {
      const minutes = parseInt(text);
      if (isNaN(minutes) || minutes < 1) {
        await ctx.reply('Пожалуйста, введите корректное число минут (> 0):');
        return;
      }

      const groupName = user.stateData?.pendingGroup;
      if (!groupName) {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        await ctx.reply(
          'Произошла ошибка (потерян контекст). Начните заново /subscribe',
        );
        return;
      }

      const sub = this.subscriptionRepository.create({
        user,
        groupName,
        notifyMinutes: minutes,
        isActive: true,
      });
      await this.subscriptionRepository.save(sub);

      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);

      await ctx.reply(
        `✅ Вы успешно подписались на расписание группы ${groupName}!\nУведомления за ${minutes} минут.`,
        this.getMainKeyboard(),
      );
    }
  }

  private async getUser(ctx: Context): Promise<User> {
    const chatId = String(ctx.chat.id);
    let user = await this.userRepository.findOne({ where: { chatId } });
    if (!user) {
      user = this.userRepository.create({
        chatId,
        firstName: ctx.from.first_name,
        isAdmin: false,
      });
      await this.userRepository.save(user);
    }
    return user;
  }

  private getMainKeyboard() {
    return Markup.keyboard([
      ['📅 Сегодня', '📅 Завтра'],
      ['📅 Неделя', '⚙️ Настройки'],
    ]).resize();
  }

  private async handleScheduleRequest(
    ctx: Context,
    user: User,
    dayOffset: number | 'week',
  ) {
    const sub = await this.subscriptionRepository.findOne({
      where: { user: { id: user.id } },
      order: { id: 'DESC' },
    });
    if (!sub) {
      await ctx.reply(
        '❌ У вас нет активных подписок. Используйте /subscribe чтобы добавить группу.',
      );
      return;
    }

    const schedule = await this.scheduleService.getSchedule(sub.groupName);
    const message = formatSchedule(schedule, dayOffset, sub.groupName);
    await ctx.reply(message);
  }
}
