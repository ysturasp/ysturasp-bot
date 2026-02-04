import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { getMainKeyboard } from '../helpers/keyboard.helper';
import { findCanonicalGroupName } from '../../helpers/group-normalizer';
import { parseTimeToMinutes, formatMinutes } from '../../helpers/time-parser';

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

  private normalizeGroupName(groupName: string): string {
    return groupName.trim().toUpperCase();
  }

  async handleSubscribe(ctx: Context, user: User): Promise<void> {
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    user.stateData = { backTarget: user.stateData?.backTarget || 'main' };
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
    buttons.push([Markup.button.callback('« Назад', 'back_dynamic')]);
    user.stateData = { backTarget: user.stateData?.backTarget || 'main' };
    await this.userRepository.save(user);
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
    if (!user.stateData || user.stateData?.backTarget !== 'settings') {
      user.stateData = { ...(user.stateData || {}), backTarget: 'settings' };
      await this.userRepository.save(user);
    }
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id } },
    });

    let msg = '⚙️ Настройки\n\n';

    if (user.preferredGroup) {
      const isSubscribed = subs.some(
        (sub) => sub.groupName === user.preferredGroup,
      );
      if (!isSubscribed) {
        msg += `📅 Группа для просмотра: <b>${user.preferredGroup}</b>\n🔕 Без уведомлений\n\n`;
      }
    }

    if (subs.length > 0) {
      msg += '🔔 Подписки с уведомлениями:\n';
      subs.forEach((sub) => {
        const isPreferred = user.preferredGroup === sub.groupName;
        msg += `👨‍💻 Группа: <b>${sub.groupName}</b>\n⏰ За ${formatMinutes(sub.notifyMinutes)}`;
        if (isPreferred) {
          msg += '\n⭐ Используется для быстрого просмотра';
        }
        msg += '\n\n';
      });
    }

    if (subs.length === 0 && !user.preferredGroup) {
      msg += 'У вас нет активных подписок и не выбрана группа для просмотра.';
    }

    const buttons: any[] = [
      [
        Markup.button.callback('➕ Подписаться', 'open_subscribe:settings'),
        Markup.button.callback('❌ Отписаться', 'open_unsubscribe'),
      ],
    ];

    if (user.preferredGroup) {
      buttons.push([
        Markup.button.callback(
          '📅 Сменить группу для просмотра',
          'open_select_group:settings',
        ),
      ]);
    } else {
      buttons.push([
        Markup.button.callback(
          '📅 Выбрать группу для просмотра',
          'open_select_group:settings',
        ),
      ]);
    }

    if (subs.length > 0) {
      buttons.push([
        Markup.button.callback(
          '⭐ Выбрать группу по умолчанию',
          'open_set_default',
        ),
      ]);
    }

    const inlineKb = Markup.inlineKeyboard(buttons);

    if (
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery
    ) {
      await ctx.answerCbQuery();
      await ctx.editMessageText?.(msg, {
        parse_mode: 'HTML',
        ...inlineKb,
      } as any);
      return;
    }

    await ctx.reply(msg, {
      parse_mode: 'HTML',
      ...getMainKeyboard(),
      ...inlineKb,
    });
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
    rows.push([Markup.button.callback('« Назад', 'back_dynamic')]);

    const keyboard = Markup.inlineKeyboard(rows);

    await ctx.editMessageText?.('Выберите подписку для удаления:', keyboard);
  }

  async handleOpenSetDefault(ctx: Context, user: User): Promise<void> {
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id } },
    });

    if (subs.length === 0) {
      await ctx.editMessageText?.('У вас нет активных подписок.');
      return;
    }

    const buttons = subs.map((sub) => [
      Markup.button.callback(`${sub.groupName}`, `set_default:${sub.id}`),
    ]);

    const rows: any[] = [];
    rows.push(...buttons);
    rows.push([Markup.button.callback('« Назад', 'back_dynamic')]);

    const keyboard = Markup.inlineKeyboard(rows);

    await ctx.editMessageText?.(
      'Выберите группу для быстрого просмотра:',
      keyboard,
    );
  }

  async handleSetDefault(
    ctx: Context,
    user: User,
    subId: number,
  ): Promise<void> {
    const sub = await this.subscriptionRepository.findOne({
      where: { id: subId },
    });
    if (!sub) {
      await ctx.answerCbQuery('Подписка не найдена');
      return;
    }

    user.preferredGroup = sub.groupName;
    await this.userRepository.save(user);

    await ctx.answerCbQuery();
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);
    await ctx.editMessageText?.(
      `✅ Быстрый просмотр будет показывать расписание группы <b>${sub.groupName}</b>.`,
      { parse_mode: 'HTML', ...kb } as any,
    );
  }

  async handleSubscribeFromSettings(ctx: Context, user: User): Promise<void> {
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    if (!user.stateData?.backTarget) {
      user.stateData = { backTarget: 'settings' };
    }
    await this.userRepository.save(user);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
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
    const normalizedGroupName = this.normalizeGroupName(groupName);
    const existing = await this.subscriptionRepository.findOne({
      where: { user: { id: user.id }, groupName: normalizedGroupName },
    });
    if (existing) {
      await ctx.answerCbQuery('Вы уже подписаны на эту группу!', {
        show_alert: true,
      });
      return;
    }

    user.state = 'WAITING_NOTIFY_TIME';
    user.stateData = {
      pendingGroup: normalizedGroupName,
      backTarget: user.stateData?.backTarget || 'main',
    };
    await this.userRepository.save(user);

    await ctx.answerCbQuery();

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '« Назад',
          `back_to_group:${normalizedGroupName}`,
        ),
      ],
    ]);

    await ctx.editMessageText(
      `✅ Группа ${normalizedGroupName} выбрана!\n\nЗа сколько до начала пары присылать уведомление?\n\nПримеры:\n• 30 или 30 минут\n• 1 час или 1ч\n• 1.5 часа\n• 1ч 30м\n• 1 день`,
      keyboard,
    );
  }

  async handleWaitingGroupSubscribe(
    ctx: Context,
    user: User,
    groupName: string,
  ): Promise<boolean> {
    const groups = await this.scheduleService.getGroups();
    const canonicalGroupName = findCanonicalGroupName(groupName, groups);

    if (!canonicalGroupName) {
      return false;
    }

    const normalizedGroupName = this.normalizeGroupName(canonicalGroupName);
    const existing = await this.subscriptionRepository.findOne({
      where: { user: { id: user.id }, groupName: normalizedGroupName },
    });
    if (existing) {
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply(
        `⚠️ Вы уже подписаны на группу <b>${normalizedGroupName}</b>.`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(),
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Выбрать другую группу', 'back_dynamic')],
          ]),
        },
      );
      return false;
    }

    user.state = 'WAITING_NOTIFY_TIME';
    user.stateData = {
      pendingGroup: normalizedGroupName,
      backTarget: user.stateData?.backTarget || 'main',
    };
    await this.userRepository.save(user);

    await ctx.reply(
      `✅ Группа ${normalizedGroupName} найдена!\n\nЗа сколько до начала занятия присылать уведомление?\n\nПримеры:\n• 30 или 30 минут\n• 1 час или 1ч\n• 1.5 часа\n• 1ч 30м\n• 1 день`,
    );
    return true;
  }

  async handleWaitingNotifyTime(
    ctx: Context,
    user: User,
    timeInput: string,
  ): Promise<boolean> {
    const minutes = parseTimeToMinutes(timeInput);

    if (minutes === null || minutes < 1) {
      await ctx.reply(
        '⚠️ Пожалуйста, введите корректное время (больше 0).\n\nПримеры:\n• 30 или 30 минут\n• 1 час или 1ч\n• 1.5 часа\n• 1ч 30м\n• 1 день',
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

    const normalizedGroupName = this.normalizeGroupName(groupName);
    const existing = await this.subscriptionRepository.findOne({
      where: { user: { id: user.id }, groupName: normalizedGroupName },
    });
    if (existing) {
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply(
        `⚠️ Вы уже подписаны на группу <b>${normalizedGroupName}</b>.`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(),
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Выбрать другую группу', 'back_dynamic')],
          ]),
        },
      );
      return false;
    }

    const sub = this.subscriptionRepository.create({
      user,
      groupName: normalizedGroupName,
      notifyMinutes: minutes,
      isActive: true,
    });
    await this.subscriptionRepository.save(sub);

    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);

    await ctx.reply(
      `✅ Готово! Вы подписались на расписание группы <b>${normalizedGroupName}</b>.\n⏰ Уведомления будут приходить за <b>${formatMinutes(minutes)}</b> до начала пары.`,
      { parse_mode: 'HTML', ...getMainKeyboard() },
    );
    return true;
  }

  async handleBackToSubscribe(ctx: Context, user: User): Promise<void> {
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    user.stateData = { backTarget: 'main' };
    await this.userRepository.save(user);

    await ctx.answerCbQuery();
    await ctx.editMessageText('Введите название группы (например, ЦИС-33):');
  }

  async handleSelectGroupForView(ctx: Context, user: User): Promise<void> {
    user.state = 'WAITING_GROUP_SELECT';
    if (!user.stateData?.backTarget) {
      user.stateData = { backTarget: 'main' };
    }
    await this.userRepository.save(user);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);

    await ctx.answerCbQuery();
    const isCallback =
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery;
    if (isCallback) {
      await ctx.editMessageText?.(
        'Введите название группы для просмотра расписания (например, ЦИС-33):',
        keyboard,
      );
    } else {
      await ctx.reply(
        'Введите название группы для просмотра расписания (например, ЦИС-33):',
        keyboard,
      );
    }
  }

  async handleQuickSelectGroup(
    ctx: Context,
    user: User,
    groupName: string,
  ): Promise<void> {
    const normalizedGroupName = this.normalizeGroupName(groupName);
    user.preferredGroup = normalizedGroupName;
    await this.userRepository.save(user);

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `✅ Группа <b>${normalizedGroupName}</b> выбрана для просмотра расписания.\n\nТеперь вы можете использовать кнопки "Сегодня", "Завтра", "Неделя" и "Экзамены" для просмотра расписания этой группы без уведомлений.`,
      {
        parse_mode: 'HTML',
      },
    );
  }

  async handleWaitingGroupSelect(
    ctx: Context,
    user: User,
    groupName: string,
  ): Promise<boolean> {
    const groups = await this.scheduleService.getGroups();
    const canonicalGroupName = findCanonicalGroupName(groupName, groups);

    if (!canonicalGroupName) {
      return false;
    }

    const normalizedGroupName = this.normalizeGroupName(canonicalGroupName);
    const backTarget = user.stateData?.backTarget || 'main';
    user.preferredGroup = normalizedGroupName;
    user.state = null;
    user.stateData = { backTarget };
    await this.userRepository.save(user);

    if (backTarget === 'settings') {
      await this.handleSubscriptions(ctx, user);
    } else {
      await ctx.reply(
        `✅ Группа <b>${normalizedGroupName}</b> выбрана для просмотра расписания.\n\nТеперь вы можете использовать кнопки "Сегодня", "Завтра", "Неделя" и "Экзамены" для просмотра расписания этой группы.`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(),
        },
      );
    }
    return true;
  }
}
