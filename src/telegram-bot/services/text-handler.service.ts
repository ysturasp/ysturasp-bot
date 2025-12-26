import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { SupportService } from './support.service';
import { PollService } from './poll.service';
import { SubscriptionService } from './subscription.service';
import { ScheduleCommandService } from './schedule-command.service';

@Injectable()
export class TextHandlerService {
  private readonly logger = new Logger(TextHandlerService.name);

  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly supportService: SupportService,
    private readonly pollService: PollService,
    private readonly subscriptionService: SubscriptionService,
    private readonly scheduleCommandService: ScheduleCommandService,
  ) {}

  async handleText(ctx: Context, user: User, text: string): Promise<boolean> {
    if (
      text === '📅 Сегодня' ||
      text === '/today' ||
      text.toLowerCase() === 'сегодня'
    ) {
      await this.scheduleCommandService.handleScheduleRequest(ctx, user.id, 0);
      return true;
    }
    if (
      text === '📅 Завтра' ||
      text === '/tomorrow' ||
      text.toLowerCase() === 'завтра'
    ) {
      await this.scheduleCommandService.handleScheduleRequest(ctx, user.id, 1);
      return true;
    }
    if (
      text === '📅 Неделя' ||
      text === '/week' ||
      text.toLowerCase() === 'неделя'
    ) {
      await this.scheduleCommandService.handleScheduleRequest(
        ctx,
        user.id,
        'week',
      );
      return true;
    }

    if (
      text === '⚙️ Настройки' ||
      text === '/settings' ||
      text.toLowerCase() === 'настройки'
    ) {
      await this.subscriptionService.handleSubscriptions(ctx, user);
      return true;
    }

    if (user.state === 'WAITING_GROUP_SUBSCRIBE') {
      const groupName = text.trim();
      return await this.subscriptionService.handleWaitingGroupSubscribe(
        ctx,
        user,
        groupName,
      );
    }

    if (user.state === 'WAITING_NOTIFY_TIME') {
      const minutes = parseInt(text);
      return await this.subscriptionService.handleWaitingNotifyTime(
        ctx,
        user,
        minutes,
      );
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      await this.supportService.handleSupportText(ctx, user, text);
      return true;
    }

    if (user.state === 'POLL_QUESTION' && user.isAdmin) {
      await this.pollService.handlePollQuestion(ctx, user, text);
      return true;
    }

    if (user.state === 'POLL_OPTIONS' && user.isAdmin) {
      const result = await this.pollService.handlePollOptions(ctx, user, text);
      return result;
    }

    if (user.state === 'POLL_IMAGE' && user.isAdmin) {
      await this.pollService.handlePollImage(ctx, user, text);
      return true;
    }

    if (user.state === 'POLL_BROADCAST' && user.isAdmin) {
      await this.pollService.handlePollBroadcast(ctx, user, text);
      return true;
    }

    const possibleGroup = text.trim();
    const schedule = await this.scheduleService.getSchedule(possibleGroup);

    if (schedule) {
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🔔 Подписаться на уведомления',
            `quick_sub:${possibleGroup}`,
          ),
        ],
        [
          Markup.button.callback(
            '📅 Посмотреть расписание',
            `quick_view:${possibleGroup}`,
          ),
        ],
      ]);

      await ctx.reply(
        `✅ Нашёл группу <b>${possibleGroup}</b>!\n\nЧто вы хотите сделать?`,
        { parse_mode: 'HTML', ...keyboard },
      );
      return true;
    }

    return false;
  }

  getHelpMessage(): string {
    return `Не удалось распознать команду или группу 🤔

Попробуйте:
• Введите название группы (например, ЦИС-33)
• Используйте кнопки внизу для расписания
• /subscribe — подписаться на уведомления

Есть вопрос? Напишите /support`;
  }
}
