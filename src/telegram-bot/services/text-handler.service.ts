import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Context, Markup } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { ScheduleService } from '../../schedule/schedule.service';
import { SupportService } from './support.service';
import { PollService } from './poll.service';
import { SubscriptionService } from './subscription.service';
import { ScheduleCommandService } from './schedule-command.service';
import { GroqService } from '../../ai/groq.service';
import { AiLimitService } from '../../ai/ai-limit.service';
import { FormatLimitClient } from '../../ai/format-limit.client';
import {
  findCanonicalGroupName,
  normalizeGroupKey,
  normalizeAudienceName,
} from '../../helpers/group-normalizer';
import { getMainKeyboard } from '../helpers/keyboard.helper';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAiContext } from '../../database/entities/user-ai-context.entity';
import {
  parseRussianDate,
  parseRussianDayOfWeek,
  getOffsetForDayOfWeek,
  parseRussianDateRange,
} from '../../helpers/date-parser';

@Injectable()
export class TextHandlerService {
  private readonly logger = new Logger(TextHandlerService.name);
  private readonly AI_SYSTEM_PROMPT =
    'Отвечай на русском языке. Отвечай максимально кратко и по делу, ' +
    'желательно не больше 2000–2500 символов. Не используй таблицы markdown, ' +
    'заголовки с # и сложное форматирование. Структурируй ответ обычными абзацами ' +
    'и простыми списками, без лишних вступлений и заключений.';

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserAiContext)
    private readonly aiContextRepository: Repository<UserAiContext>,
    private readonly scheduleService: ScheduleService,
    private readonly supportService: SupportService,
    private readonly pollService: PollService,
    private readonly subscriptionService: SubscriptionService,
    private readonly scheduleCommandService: ScheduleCommandService,
    private readonly groqService: GroqService,
    private readonly aiLimitService: AiLimitService,
    private readonly formatLimitClient: FormatLimitClient,
  ) {}

  async handleText(ctx: Context, user: User, text: string): Promise<boolean> {
    const chatType =
      (ctx.chat && (ctx.chat as any).type) ||
      ((ctx.message as any)?.chat && (ctx.message as any).chat.type);

    const cancelKeywords = ['отмена', 'cancel', 'стоп', 'stop'];
    const mainMenuButtons = [
      '📅 Сегодня',
      '📅 Завтра',
      '📅 Неделя',
      '📝 Экзамены',
      '⚙️ Настройки',
    ];

    if (
      user.state &&
      (text.startsWith('/') ||
        cancelKeywords.some((k) => text.toLowerCase().trim() === k) ||
        mainMenuButtons.includes(text))
    ) {
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);

      if (!text.startsWith('/') && !mainMenuButtons.includes(text)) {
        await ctx.reply('✅ Операция отменена. Можете начать заново.', {
          ...getMainKeyboard(),
        });
        return true;
      }
    }

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

    const lowerText = text.toLowerCase().trim();
    const multiWeekCount = this.parseMultiWeekCountRequest(text);
    if (multiWeekCount && multiWeekCount >= 2) {
      await ctx.reply(
        `⚠️ Расписание сразу на ${multiWeekCount} недели может быть слишком большим.\n\nОткрою просмотр по неделям — листайте кнопками «Следующая 👉».`,
      );
      await this.scheduleCommandService.handleScheduleRequest(
        ctx,
        user.id,
        'week',
      );
      return true;
    }
    if (
      text === '📅 Сегодня' ||
      text === '/today' ||
      lowerText === 'сегодня' ||
      lowerText === 'расписание на сегодня'
    ) {
      await this.scheduleCommandService.handleScheduleRequest(ctx, user.id, 0);
      return true;
    }
    if (
      text === '📅 Завтра' ||
      text === '/tomorrow' ||
      lowerText === 'завтра' ||
      lowerText === 'расписание на завтра'
    ) {
      await this.scheduleCommandService.handleScheduleRequest(ctx, user.id, 1);
      return true;
    }
    if (
      text === '📅 Неделя' ||
      text === '/week' ||
      lowerText.startsWith('неделя') ||
      lowerText === 'расписание на неделю'
    ) {
      const range = parseRussianDateRange(text);
      if (range) {
        const offset = this.calculateWeekOffset(range.start);
        await this.scheduleCommandService.handleScheduleRequest(
          ctx,
          user.id,
          'week',
          offset,
        );
        return true;
      }

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

    if (text.toLowerCase().trim() === 'месяц') {
      await ctx.reply(
        '⚠️ Расписание на месяц слишком большое для одного сообщения. Пожалуйста, используйте просмотр по неделям.',
      );
      return true;
    }

    const soloRange = parseRussianDateRange(text);
    if (soloRange) {
      const offset = this.calculateWeekOffset(soloRange.start);
      await this.scheduleCommandService.handleScheduleRequest(
        ctx,
        user.id,
        'week',
        offset,
      );
      return true;
    }

    const dayOfWeek = parseRussianDayOfWeek(text);
    if (dayOfWeek !== null) {
      const offset = getOffsetForDayOfWeek(dayOfWeek);
      await this.scheduleCommandService.handleScheduleRequest(
        ctx,
        user.id,
        offset,
      );
      return true;
    }

    const specificDate = parseRussianDate(text);
    if (specificDate) {
      await this.scheduleCommandService.handleScheduleRequest(
        ctx,
        user.id,
        specificDate,
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

    const originalText = text.trim();
    const extractedGroup = this.extractGroupFromMessage(text);
    if (extractedGroup) {
      text = extractedGroup;
    }

    if (user.state === 'WAITING_GROUP_SUBSCRIBE') {
      if (chatType !== 'private') return false;
      const groupName = text.trim();
      const result = await this.subscriptionService.handleWaitingGroupSubscribe(
        ctx,
        user,
        groupName,
        true,
      );
      if (result) return true;

      const searched = await this.tryHandleSearch(ctx, user, text);
      if (searched) {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        return true;
      }

      await ctx.reply(
        `Группа <b>${groupName}</b> не найдена. Проверьте название и попробуйте ещё раз.`,
        { parse_mode: 'HTML' },
      );
      return true;
    }

    if (user.state === 'WAITING_GROUP_SELECT') {
      if (chatType !== 'private') return false;
      const groupName = text.trim();
      const result = await this.subscriptionService.handleWaitingGroupSelect(
        ctx,
        user,
        groupName,
        true,
      );
      if (result) return true;

      const searched = await this.tryHandleSearch(ctx, user, text);
      if (searched) {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        return true;
      }

      await ctx.reply(
        `Группа <b>${groupName}</b> не найдена. Проверьте название и попробуйте ещё раз.`,
        { parse_mode: 'HTML' },
      );
      return true;
    }

    if (user.state === 'WAITING_NOTIFY_TIME') {
      const handled = await this.subscriptionService.handleWaitingNotifyTime(
        ctx,
        user,
        text,
        true,
      );
      if (handled) return true;

      const searched = await this.tryHandleSearch(ctx, user, text);
      if (searched) {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        return true;
      }

      await ctx.reply(
        '⚠️ Пожалуйста, введите корректное время (больше 0).\n\nПримеры:\n• 30 или 30 минут\n• 1 час или 1ч\n• 1.5 часа\n• 1ч 30м\n• 1 день',
      );
      return true;
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      const isButtonTrigger =
        text === '📅 Сегодня' || text === '📅 Завтра' || text === '📅 Неделя';
      if (isButtonTrigger) {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
      } else {
        await this.supportService.handleSupportText(ctx, user, text);
        return true;
      }
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

    const searchHandled = await this.tryHandleSearch(ctx, user, text);
    if (searchHandled) return true;

    if (chatType === 'private') {
      return await this.handleAiFallback(ctx, user, text);
    }

    return false;
  }

  async handleVoice(ctx: Context, user: User): Promise<void> {
    const message = ctx.message as any;
    const voice = message.voice;

    try {
      await ctx.sendChatAction('typing');
      const fileLink = await ctx.telegram.getFileLink(voice.file_id);
      const response = await axios.get(fileLink.toString(), {
        responseType: 'arraybuffer',
      });
      const buffer = Buffer.from(response.data);

      const transcription = await this.groqService.transcribe(
        buffer,
        `voice_${voice.file_id}.ogg`,
      );

      await ctx.reply(
        `🎤 <b>Распознанный текст:</b>\n<i>${transcription}</i>`,
        { parse_mode: 'HTML' },
      );

      await this.handleAiFallback(ctx, user, transcription);
    } catch (error) {
      this.logger.error(`Voice processing error: ${error.message}`);
      await ctx.reply('❌ Не удалось распознать голосовое сообщение.');
    }
  }

  async handlePhoto(ctx: Context, user: User): Promise<void> {
    const message = ctx.message as any;
    const photo = message.photo[message.photo.length - 1];
    const caption = message.caption || 'Что на этом изображении?';

    const canRequest = await this.aiLimitService.canRequest(user);
    if (!canRequest) {
      await ctx.reply('⚠️ Вы исчерпали лимит запросов к ИИ.');
      return;
    }

    try {
      await ctx.sendChatAction('typing');
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);

      const res = await axios.get(fileLink.toString(), {
        responseType: 'arraybuffer',
      });
      const base64Image = Buffer.from(res.data).toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;

      const response = await this.groqService.chatCompletion(
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: caption },
              { type: 'image_url', image_url: { url: dataUrl } },
            ] as any,
          },
        ],
        user.aiModel.includes('maverick') || user.aiModel.includes('scout')
          ? user.aiModel
          : 'meta-llama/llama-4-maverick-17b-128e-instruct',
      );

      await this.aiLimitService.incrementUsage(user);
      await this.userRepository.save(user);

      await this.sendSmartReply(ctx, response);
    } catch (error) {
      this.logger.error(`Photo processing error: ${error.message}`);
      await ctx.reply('❌ Не удалось обработать изображение.');
    }
  }

  private async handleAiFallback(
    ctx: Context,
    user: User,
    text: string,
  ): Promise<boolean> {
    const canRequest = await this.aiLimitService.canRequest(user);
    if (!canRequest) {
      const limit = await this.aiLimitService.getMonthlyLimit(user);
      const resetDate = await this.aiLimitService.getNextResetDate(user);
      await ctx.reply(
        `⚠️ Вы исчерпали лимит запросов к ИИ (${limit}/${limit}).\n\nНовый лимит будет доступен примерно с <b>${resetDate.toLocaleDateString(
          'ru-RU',
        )}</b>. Подписка /plus — 200 запросов в месяц.`,
      );
      return true;
    }

    try {
      await ctx.sendChatAction('typing');

      const previousMessages =
        (await this.aiContextRepository.find({
          where: { user: { id: user.id } },
          order: { createdAt: 'ASC' },
          take: 16,
          relations: ['user'],
        })) || [];

      const userMessage = this.aiContextRepository.create({
        user,
        role: 'user',
        content: text,
      });
      await this.aiContextRepository.save(userMessage);

      const history = [...previousMessages, userMessage];

      const limitedContext = history.slice(-8);

      const systemMessage = {
        role: 'system',
        content: this.AI_SYSTEM_PROMPT,
      };

      const response = await this.groqService.chatCompletion(
        [systemMessage, ...limitedContext].map((c) => ({
          role: c.role,
          content: c.content,
        })) as any,
        user.aiModel,
      );

      await this.aiLimitService.incrementUsage(user);

      const assistantMessage = this.aiContextRepository.create({
        user,
        role: 'assistant',
        content: response,
      });
      await this.aiContextRepository.save(assistantMessage);

      await this.sendSmartReply(ctx, response);
      return true;
    } catch (error) {
      this.logger.error(`AI Fallback error: ${error.message}`);
      await ctx.reply(
        '❌ К сожалению, произошла ошибка при обращении к ИИ. Попробуйте позже или используйте /reset.',
      );
      return true;
    }
  }

  private async sendSmartReply(ctx: Context, text: string): Promise<void> {
    const CHUNK_SIZE = 3800;

    text = this.preprocessMarkdownForTelegram(text);

    const chunks: string[] = [];
    let currentChunk = '';
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length + 1 > CHUNK_SIZE) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = paragraph;
      } else {
        currentChunk = currentChunk
          ? `${currentChunk}\n${paragraph}`
          : paragraph;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    for (const chunk of chunks) {
      try {
        const html = this.mdToHtml(chunk);
        await ctx.reply(html, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (error) {
        this.logger.warn(
          `HTML parsing failed, falling back to plain text for chunk: ${error.message}`,
        );
        await ctx.reply(chunk);
      }
    }
  }

  private preprocessMarkdownForTelegram(md: string): string {
    const lines = md.split('\n');
    const result: string[] = [];

    const isSeparatorRow = (line: string): boolean =>
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

    const splitTableRow = (line: string): string[] => {
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      return trimmed.split('|').map((cell) => cell.trim());
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        if (result.length && result[result.length - 1].trim() !== '') {
          result.push('');
        }
        i++;
        continue;
      }

      const next = i + 1 < lines.length ? lines[i + 1] : null;
      if (line.includes('|') && next && isSeparatorRow(next)) {
        i += 2;

        while (i < lines.length && lines[i].includes('|')) {
          const rowLine = lines[i];
          const cells = splitTableRow(rowLine);

          if (cells.length >= 2) {
            const title = cells[0];
            const value = cells.slice(1).join(' | ');
            result.push(`- **${title}**: ${value}`);
          } else if (cells.length === 1) {
            result.push(`- ${cells[0]}`);
          }

          i++;
        }

        result.push('');
        continue;
      }

      const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
      if (headingMatch) {
        const title = headingMatch[1].trim();
        if (result.length > 0 && result[result.length - 1].trim() !== '') {
          result.push('');
        }
        result.push(`**${title}**`);
        result.push('');
        i++;
        continue;
      }

      let processed = line;

      if (/^\s*>\s+/.test(processed)) {
        processed = processed.replace(/^\s*>\s+/, '');
      }

      const checkboxMatch = processed.match(/^\s*[-*]\s+\[(?: |x|X)\]\s*(.+)$/);
      if (checkboxMatch) {
        processed = `• ${checkboxMatch[1]}`;
      } else {
        const listMatch = processed.match(/^\s*[-*]\s+(.+)$/);
        if (listMatch) {
          processed = `• ${listMatch[1]}`;

          processed = processed.replace(/^• \*+(\S.*)$/, '• $1');
        }
      }

      result.push(processed);
      i++;
    }

    let output = result.join('\n');

    output = output.replace(/\s\|\s+/g, '\n• ');

    return output;
  }

  private mdToHtml(md: string): string {
    const codeBlocks: string[] = [];
    const placeholder = '\u0001PRE\u0002';
    let text = md;

    text = text.replace(/```([\s\S]*?)```/g, (_, block) => {
      const idx = codeBlocks.length;
      codeBlocks.push(block);
      return placeholder + idx + placeholder;
    });

    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
      .replace(/\*/g, '');

    codeBlocks.forEach((block, idx) => {
      const safe = block
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      text = text.replace(
        placeholder + idx + placeholder,
        '<pre>' + safe + '</pre>',
      );
    });

    return text;
  }

  private async tryHandleSearch(
    ctx: Context,
    user: User,
    text: string,
  ): Promise<boolean> {
    const originalText = text.trim();
    const extractedGroup = this.extractGroupFromMessage(text);
    if (extractedGroup) {
      text = extractedGroup;
    }

    const groups = await this.scheduleService.getGroups();
    let possibleGroup = text.trim();
    let canonicalGroup = findCanonicalGroupName(possibleGroup, groups);

    if (!canonicalGroup && originalText !== possibleGroup) {
      canonicalGroup = findCanonicalGroupName(originalText, groups);
    }

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

    const groupish =
      !!extractedGroup ||
      this.looksLikeGroupQuery(possibleGroup) ||
      this.looksLikeGroupQuery(originalText);
    if (groupish) {
      const raw = extractedGroup || this.extractFirstGroupToken(originalText);
      const shown = raw || possibleGroup || originalText;
      const suggestions = this.getGroupSuggestions(shown, groups, 6);

      if (suggestions.length > 0) {
        const rows: any[] = [];
        for (let i = 0; i < suggestions.length; i += 2) {
          const row = suggestions
            .slice(i, i + 2)
            .map((g) => Markup.button.callback(g, `quick_view:${g}`));
          rows.push(row);
        }
        rows.push([
          Markup.button.callback(
            '📌 Выбрать группу вручную',
            'open_select_group:main',
          ),
        ]);
        const keyboard = Markup.inlineKeyboard(rows);

        await ctx.reply(
          `❌ Группа <b>${shown.toUpperCase()}</b> не найдена.\n\nВозможно, вы имели в виду:`,
          { parse_mode: 'HTML', ...keyboard },
        );
        return true;
      }

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '📌 Выбрать группу вручную',
            'open_select_group:main',
          ),
        ],
      ]);
      await ctx.reply(
        `❌ Группа <b>${shown.toUpperCase()}</b> не найдена.\n\nПроверьте название или выберите группу вручную.`,
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

    return await this.handleTeacherSearch(ctx, text);
  }

  private async handleTeacherSearch(
    ctx: Context,
    text: string,
  ): Promise<boolean> {
    const teachers = await this.scheduleService.getTeachers();
    const searchQuery = text.toLowerCase().trim();

    const matchingTeachers = teachers.filter((t) => {
      const teacherName = t.name.toLowerCase();

      if (teacherName.includes(searchQuery)) {
        return true;
      }

      const parts = teacherName.split(' ');
      if (parts.length >= 2) {
        const surname = parts[0];
        const name = parts[1];
        const patronymic = parts[2] || '';

        const nameInitial = name.charAt(0);
        const patronymicInitial = patronymic ? patronymic.charAt(0) : '';

        const cleanQuery = searchQuery.replace(/[\s.]/g, '');

        const variants = [
          `${surname}${nameInitial}.${patronymicInitial}.`,
          `${surname}${nameInitial}.${patronymicInitial}`,
          `${surname}${nameInitial}.`,
          `${nameInitial}.${patronymicInitial}.${surname}`,
          `${nameInitial}.${patronymicInitial}${surname}`,
          `${nameInitial}.${surname}`,
          `${surname}${nameInitial}${patronymicInitial}`,
          `${surname}${nameInitial}`,
          `${nameInitial}${patronymicInitial}${surname}`,
          `${nameInitial}${surname}`,
        ];

        if (
          variants.some(
            (v) => v.replace(/[\s.]/g, '').toLowerCase() === cleanQuery,
          )
        ) {
          return true;
        }

        const queryParts = searchQuery.split(/\s+/);
        if (queryParts.length === 2) {
          const [part1, part2] = queryParts;
          const clean1 = part1.replace(/\./g, '');
          const clean2 = part2.replace(/\./g, '');

          const checks = [
            surname.startsWith(clean1) &&
              clean2.length <= 2 &&
              nameInitial.startsWith(clean2.charAt(0)),
            surname.startsWith(clean2) &&
              clean1.length <= 2 &&
              nameInitial.startsWith(clean1.charAt(0)),
          ];

          if (checks.some((c) => c)) {
            return true;
          }
        }
      }

      return false;
    });

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
      'покажи расписание',
      'показать расписание',
      'hfcgbcfybt',
    ];

    return scheduleKeywords.some((keyword) => lowerText === keyword);
  }

  private extractGroupFromMessage(text: string): string | null {
    const trimmedText = text.trim();

    const patterns = [
      /(?:расписание|расписаие|распис|покажи|дай|смотреть|посмотреть|показать|глянуть|гляну|дайте|хочу|нужно|надо)\s+(?:на\s+)?(?:следующую\s+)?(?:эту\s+)?(?:неделю\s+)?([а-яёА-ЯЁa-zA-Z]{1,5}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)/iu,

      /(?:расписание|расписаие|распис|покажи|дай|смотреть|посмотреть|показать|глянуть|гляну|дайте|хочу|нужно|надо)\s+([а-яёА-ЯЁa-zA-Z]{1,5}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)/iu,

      /(?:на\s+(?:сегодня|завтра|неделю|следующую\s+неделю|эту\s+неделю|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))\s+([а-яёА-ЯЁa-zA-Z]{1,5}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)/iu,

      /^([а-яёА-ЯЁa-zA-Z]{1,8}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)\s+(?:неделя|сегодня|завтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\b/iu,

      /^(?:неделя|сегодня|завтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\s+([а-яёА-ЯЁa-zA-Z]{1,8}[-\s]?\d{1,2}[а-яёА-ЯЁa-zA-Z]?)/iu,

      /^([а-яёА-ЯЁa-zA-Z]{1,5})[-\s]+(\d{1,2}[а-яёА-ЯЁa-zA-Z]?)$/iu,

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
          groupName = `${match[1].trim()}-${match[2].trim()}`;
        } else {
          continue;
        }

        groupName = groupName.replace(/\s+/g, '-').toUpperCase();

        if (groupName.length >= 3 && groupName.length <= 10) {
          return groupName;
        }
      }
    }

    return null;
  }

  private parseMultiWeekCountRequest(text: string): number | null {
    const normalized = String(text || '')
      .toLowerCase()
      .replace(
        /^(?:расписание|распис|раписание|расписаие|распесание|рапсписание|рачписание|рачсписание|расрисание)\s+(?:на\s+)?/iu,
        '',
      )
      .trim()
      .replace(/\s+/g, ' ');

    const m = normalized.match(/^(\d{1,2})\s*недел(?:я|и|ь|ю)\b/u);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  private looksLikeGroupQuery(text: string): boolean {
    const t = String(text || '').trim();
    if (!t) return false;
    return /^(?:[а-яёa-z]{1,8})[-\s]?\d{1,2}[а-яёa-z]?$/iu.test(t);
  }

  private extractFirstGroupToken(text: string): string | null {
    const t = String(text || '').trim();
    if (!t) return null;
    const m = t.match(/([а-яёA-ЯЁa-zA-Z]{1,8}[-\s]?\d{1,2}[а-яёA-ЯЁa-zA-Z]?)/u);
    if (!m) return null;
    const token = m[1].replace(/\s+/g, '-').toUpperCase();
    if (!this.looksLikeGroupQuery(token)) return null;
    return token;
  }

  private levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;

    const alen = a.length;
    const blen = b.length;

    const prev = new Array<number>(blen + 1);
    const curr = new Array<number>(blen + 1);
    for (let j = 0; j <= blen; j++) prev[j] = j;

    for (let i = 1; i <= alen; i++) {
      curr[0] = i;
      const ac = a.charCodeAt(i - 1);
      for (let j = 1; j <= blen; j++) {
        const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= blen; j++) prev[j] = curr[j];
    }

    return prev[blen];
  }

  private getGroupSuggestions(
    input: string,
    groups: string[] | null | undefined,
    limit = 6,
  ): string[] {
    if (!groups || groups.length === 0) return [];

    const inputKey = normalizeGroupKey(String(input || ''));
    if (!inputKey) return [];

    const digits = inputKey.match(/\d{1,2}/)?.[0] || '';
    const scored = groups.map((g) => {
      const name = String(g).trim();
      const key = normalizeGroupKey(name);
      const d = this.levenshtein(inputKey, key);
      const digitBonus = digits && key.includes(digits) ? -1 : 0;
      const score = d + digitBonus;
      return { name, score };
    });

    scored.sort((x, y) => x.score - y.score || x.name.length - y.name.length);
    const topScore = scored[0]?.score ?? 999;

    const picked: string[] = [];
    for (const s of scored) {
      if (picked.length >= limit) break;
      if (s.score > Math.min(6, topScore + 2)) break;
      if (!picked.includes(s.name)) picked.push(s.name);
    }
    return picked;
  }

  private calculateWeekOffset(targetDate: Date): number {
    const now = new Date();
    const currentMonday = new Date(now);
    const currentDay = now.getDay() || 7;
    currentMonday.setDate(now.getDate() - (currentDay - 1));
    currentMonday.setHours(0, 0, 0, 0);

    const targetMonday = new Date(targetDate);
    const targetDay = targetDate.getDay() || 7;
    targetMonday.setDate(targetDate.getDate() - (targetDay - 1));
    targetMonday.setHours(0, 0, 0, 0);

    const diffMs = targetMonday.getTime() - currentMonday.getTime();
    return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
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
