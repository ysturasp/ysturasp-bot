import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { getMainKeyboard } from '../helpers/keyboard.helper';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly scheduleService: ScheduleService,
  ) {}

  async handleSubscribe(ctx: Context, user: User): Promise<void> {
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    await this.userRepository.save(user);
    await ctx.reply('Введите название группы (например, ЦИС-33):');
  }

  async handleUnsubscribe(ctx: Context, user: User): Promise<void> {
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id } },
    });

    if (subs.length === 0) {
      await ctx.editMessageText?.('У вас нет активных подписок.');
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

  async handleUnsubscribeAction(ctx: Context, subId: number): Promise<void> {
    await this.subscriptionRepository.delete(subId);
    await ctx.answerCbQuery('Подписка удалена');
    await ctx.editMessageText('✅ Подписка успешно удалена.');
  }

  async handleSubscriptions(ctx: Context, user: User): Promise<void> {
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id } },
    });

    if (subs.length === 0) {
      await ctx.reply('У вас нет активных подписок.');
      return;
    }

    let msg = '⚙️ Ваши подписки:\n\n';
    subs.forEach((sub) => {
      msg += `👨‍💻 Группа: ${sub.groupName}\n⏰ За ${sub.notifyMinutes} минут\n\n`;
    });

    const inlineKb = Markup.inlineKeyboard([
      [
        Markup.button.callback('➕ Подписаться', 'open_subscribe'),
        Markup.button.callback('❌ Отписаться', 'open_unsubscribe'),
      ],
    ]);

    if (
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery
    ) {
      await ctx.answerCbQuery();
      await ctx.editMessageText?.(msg, inlineKb as any);
      return;
    }

    await ctx.reply(msg, { ...getMainKeyboard(), ...inlineKb });
  }

  async handleUnsubscribeFromSettings(ctx: Context, user: User): Promise<void> {
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

    const rows: any[] = [];
    rows.push(...buttons);
    rows.push([Markup.button.callback('« Назад', 'back_to_subscriptions')]);

    const keyboard = Markup.inlineKeyboard(rows);

    await ctx.editMessageText?.('Выберите подписку для удаления:', keyboard);
  }

  async handleSubscribeFromSettings(ctx: Context, user: User): Promise<void> {
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    await this.userRepository.save(user);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_to_subscriptions')],
    ]);

    await ctx.editMessageText?.(
      'Введите название группы (например, ЦИС-33):',
      keyboard,
    );
  }

  async handleQuickSubscribe(
    ctx: Context,
    user: User,
    groupName: string,
  ): Promise<void> {
    const existing = await this.subscriptionRepository.findOne({
      where: { user: { id: user.id }, groupName },
    });
    if (existing) {
      await ctx.answerCbQuery('Вы уже подписаны на эту группу!', {
        show_alert: true,
      });
      return;
    }

    user.state = 'WAITING_NOTIFY_TIME';
    user.stateData = { pendingGroup: groupName };
    await this.userRepository.save(user);

    await ctx.answerCbQuery();

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', `back_to_group:${groupName}`)],
    ]);

    await ctx.editMessageText(
      `✅ Группа ${groupName} выбрана!\n\nЗа сколько минут до начала пары присылать уведомление? (Напишите число, например 30)`,
      keyboard,
    );
  }

  async handleWaitingGroupSubscribe(
    ctx: Context,
    user: User,
    groupName: string,
  ): Promise<boolean> {
    const schedule = await this.scheduleService.getSchedule(groupName);

    if (!schedule) {
      await ctx.reply(
        `❌ Группа "${groupName}" не найдена. Попробуйте еще раз (например, ЦИС-33):`,
      );
      return false;
    }

    const existing = await this.subscriptionRepository.findOne({
      where: { user: { id: user.id }, groupName },
    });
    if (existing) {
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply(`⚠️ Вы уже подписаны на группу <b>${groupName}</b>.`, {
        parse_mode: 'HTML',
        ...getMainKeyboard(),
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              'Выбрать другую группу',
              'back_to_subscribe',
            ),
          ],
        ]),
      });
      return false;
    }

    user.state = 'WAITING_NOTIFY_TIME';
    user.stateData = { pendingGroup: groupName };
    await this.userRepository.save(user);

    await ctx.reply(
      `✅ Группа ${groupName} найдена!\n\nЗа сколько минут до начала занятия присылать уведомление? (Напишите число, например 30)`,
    );
    return true;
  }

  async handleWaitingNotifyTime(
    ctx: Context,
    user: User,
    minutes: number,
  ): Promise<boolean> {
    if (isNaN(minutes) || minutes < 1) {
      await ctx.reply(
        '⚠️ Пожалуйста, введите корректное число минут (больше 0):',
      );
      return false;
    }

    const groupName = user.stateData?.pendingGroup;
    if (!groupName) {
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply(
        '⚠️ Произошла ошибка (потерян контекст). Начните заново нажав /subscribe',
      );
      return false;
    }

    const existing = await this.subscriptionRepository.findOne({
      where: { user: { id: user.id }, groupName },
    });
    if (existing) {
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply(`⚠️ Вы уже подписаны на группу <b>${groupName}</b>.`, {
        parse_mode: 'HTML',
        ...getMainKeyboard(),
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              'Выбрать другую группу',
              'back_to_subscribe',
            ),
          ],
        ]),
      });
      return false;
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
      `✅ Готово! Вы подписались на расписание группы <b>${groupName}</b>.\n⏰ Уведомления будут приходить за <b>${minutes} мин</b> до начала пары.`,
      { parse_mode: 'HTML', ...getMainKeyboard() },
    );
    return true;
  }

  async handleBackToSubscribe(ctx: Context, user: User): Promise<void> {
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    user.stateData = null;
    await this.userRepository.save(user);

    await ctx.answerCbQuery();
    await ctx.editMessageText('Введите название группы (например, ЦИС-33):');
  }
}
