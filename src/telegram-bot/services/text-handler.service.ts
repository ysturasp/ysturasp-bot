import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { SupportService } from './support.service';
import { PollService } from './poll.service';
import { SubscriptionService } from './subscription.service';
import { ScheduleCommandService } from './schedule-command.service';
import { findCanonicalGroupName } from '../../helpers/group-normalizer';

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
    const chatType =
      (ctx.chat && (ctx.chat as any).type) ||
      ((ctx.message as any)?.chat && (ctx.message as any).chat.type);
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
      text === '📝 Экзамены' ||
      text === '/exams' ||
      text.toLowerCase() === 'экзамены'
    ) {
      await this.scheduleCommandService.handleExams(ctx, user.id);
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
      if (chatType !== 'private') return false;
      const groupName = text.trim();
      const result = await this.subscriptionService.handleWaitingGroupSubscribe(
        ctx,
        user,
        groupName,
      );
      if (!result) {
        await ctx.reply(
          `Группа <b>${groupName}</b> не найдена. Проверьте название и попробуйте ещё раз.`,
          { parse_mode: 'HTML' },
        );
        return true;
      }
      return true;
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

    if (user.state === 'ADMIN_REPLY' && user.isAdmin) {
      const target = user.stateData?.targetChatId;
      if (!target) {
        user.state = null;
        user.stateData = null;
        return false;
      }
      await this.supportService.handleReplyCommand(ctx, target, text);
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

    const groups = await this.scheduleService.getGroups();
    const canonicalGroup = findCanonicalGroupName(possibleGroup, groups);

    if (canonicalGroup) {
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🔔 Подписаться на уведомления',
            `quick_sub:${canonicalGroup}`,
          ),
        ],
        [
          Markup.button.callback(
            '📅 Посмотреть расписание',
            `quick_view:${canonicalGroup}`,
          ),
        ],
      ]);

      await ctx.reply(
        `✅ Нашёл группу <b>${canonicalGroup}</b>!\n\nЧто вы хотите сделать?`,
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
