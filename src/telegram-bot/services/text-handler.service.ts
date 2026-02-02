import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { SupportService } from './support.service';
import { PollService } from './poll.service';
import { SubscriptionService } from './subscription.service';
import { ScheduleCommandService } from './schedule-command.service';
import {
  findCanonicalGroupName,
  normalizeAudienceName,
} from '../../helpers/group-normalizer';

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

    if (this.isScheduleRequest(text)) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📅 Сегодня', 'schedule_day:0')],
        [Markup.button.callback('📅 Завтра', 'schedule_day:1')],
        [Markup.button.callback('📅 Неделя', 'schedule_week')],
        [Markup.button.callback('📝 Экзамены', 'show_exams')],
      ]);

      await ctx.reply('Выберите, что хотите посмотреть:', keyboard);
      return true;
    }

    const extractedGroup = this.extractGroupFromMessage(text);
    if (extractedGroup) {
      text = extractedGroup;
    }

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

    if (user.state === 'WAITING_GROUP_SELECT') {
      if (chatType !== 'private') return false;
      const groupName = text.trim();
      const result = await this.subscriptionService.handleWaitingGroupSelect(
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
            '📌 Только просмотр кнопками',
            `quick_select_group:${canonicalGroup}`,
          ),
        ],
        [
          Markup.button.callback(
            '📅 Быстрый просмотр',
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

    const audiences = await this.scheduleService.getAudiences();
    const cleanText = normalizeAudienceName(text);
    const matchingAudiences = audiences.filter((a) => {
      const cleanName = normalizeAudienceName(a.name);
      return cleanName.includes(cleanText);
    });

    if (matchingAudiences.length === 1) {
      const audience = matchingAudiences[0];
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '📅 Сегодня',
            `view_audience_day:${audience.id}:0`,
          ),
          Markup.button.callback(
            '📅 Завтра',
            `view_audience_day:${audience.id}:1`,
          ),
        ],
        [
          Markup.button.callback(
            '📅 Неделя',
            `view_audience_week:${audience.id}`,
          ),
        ],
      ]);
      await ctx.reply(
        `🏛 Выбрано: <b>${audience.name}</b>\nПоказать расписание?`,
        {
          parse_mode: 'HTML',
          ...keyboard,
        },
      );
      return true;
    } else if (matchingAudiences.length > 1) {
      const query = text.trim();
      await this.scheduleCommandService.handleAudienceSearch(ctx, query, 0);
      return true;
    }

    const teachers = await this.scheduleService.getTeachers();
    const matchingTeachers = teachers.filter((t) =>
      t.name.toLowerCase().includes(text.toLowerCase().trim()),
    );

    if (matchingTeachers.length === 1) {
      const teacher = matchingTeachers[0];
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '📅 Сегодня',
            `view_teacher_day:${teacher.id}:0`,
          ),
          Markup.button.callback(
            '📅 Завтра',
            `view_teacher_day:${teacher.id}:1`,
          ),
        ],
        [
          Markup.button.callback(
            '📅 Неделя',
            `view_teacher_week:${teacher.id}`,
          ),
        ],
      ]);
      await ctx.reply(
        `👨‍🏫 Нашёл преподавателя: <b>${teacher.name}</b>\nПоказать расписание?`,
        { parse_mode: 'HTML', ...keyboard },
      );
      return true;
    } else if (matchingTeachers.length > 1) {
      const query = text.trim();
      await this.scheduleCommandService.handleTeacherSearch(ctx, query, 0);
      return true;
    }

    return false;
  }

  private isScheduleRequest(text: string): boolean {
    const lowerText = text.toLowerCase().trim();
    const scheduleKeywords = [
      'расписание',
      'распис',
      'раписание',
      'расписаие',
      'распесание',
      'рапсписание',
      'рачписание',
      'рачсписание',
      'расрисание',
      'расписание на сегодня',
      'расписание на завтра',
      'расписание на неделю',
      'покажи расписание',
      'показать расписание',
      'hfcgbcfybt',
    ];

    return scheduleKeywords.some((keyword) => lowerText === keyword);
  }

  private extractGroupFromMessage(text: string): string | null {
    const trimmedText = text.trim();

    const patterns = [
      /(?:расписание|расписаие|распис|покажи|дай|смотреть|посмотреть|показать|глянуть|гляну|дайте|хочу|нужно|надо)\s+([а-яёА-ЯЁa-zA-Z]{1,5}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)/iu,

      /(?:на\s+(?:сегодня|завтра|неделю|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))\s+([а-яёА-ЯЁa-zA-Z]{1,5}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)/iu,

      /^([а-яёА-ЯЁa-zA-Z]{1,5})[-\s](\d{1,2}[а-яёА-ЯЁa-zA-Z]?)$/iu,

      /^([а-яёА-ЯЁa-zA-Z]{1,5})(\d{1,2}[а-яёА-ЯЁa-zA-Z]?)$/iu,

      /([а-яёА-ЯЁa-zA-Z]{1,5}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)$/iu,
    ];

    for (const pattern of patterns) {
      const match = trimmedText.match(pattern);
      if (match) {
        let groupName: string;

        if (match.length === 2) {
          groupName = match[1].trim();
        } else if (match.length === 3) {
          groupName = `${match[1]}-${match[2]}`;
        } else {
          continue;
        }

        groupName = groupName.replace(/\s+/g, '-').toUpperCase();

        if (groupName.length >= 3 && groupName.length <= 8) {
          return groupName;
        }
      }
    }

    return null;
  }

  getHelpMessage(): string {
    return `Не удалось распознать 🤔

Попробуйте ввести:
• Название группы (например, ЦИС-33)
• ФИО преподавателя (например, Иванов И.И.)
• Номер аудитории (например, 633)

Или используйте кнопки для навигации`;
  }
}
