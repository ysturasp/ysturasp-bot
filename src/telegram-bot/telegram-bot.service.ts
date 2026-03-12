import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import axios from 'axios';
import { Context, Markup } from 'telegraf';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import Redis from 'ioredis';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { ConfigService } from '@nestjs/config';
import { getMainKeyboard } from './helpers/keyboard.helper';
import { SupportService } from './services/support.service';
import { PollService } from './services/poll.service';
import {
  BroadcastService,
  parseBroadcastExclude,
} from './services/broadcast.service';
import { SubscriptionService } from './services/subscription.service';
import { ScheduleCommandService } from './services/schedule-command.service';
import { UserHelperService } from './services/user-helper.service';
import { TextHandlerService } from './services/text-handler.service';
import { YearEndBroadcastService } from './services/year-end-broadcast.service';
import { ReferralService } from './services/referral.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { getFooterLinks } from '../config/links.config';
import { GroqService } from '../ai/groq.service';
import { AiLimitService } from '../ai/ai-limit.service';
import { AiSubscriptionService } from '../ai/ai-subscription.service';
import { FormatLimitClient } from '../ai/format-limit.client';
import { UserAiContext } from '../database/entities/user-ai-context.entity';
import { UserAiPayment } from '../database/entities/user-ai-payment.entity';
import { YooCheckout, ICreateRefund } from '@a2seven/yoo-checkout';
import * as crypto from 'crypto';
import { escapeHtml } from '../helpers/html-escaper';
import { TelegramCustomEmojis } from './helpers/emoji.helper';

@Update()
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @Inject('REDIS') private readonly redis: Redis,
    private readonly entityManager: EntityManager,
    private readonly scheduleService: ScheduleService,
    private readonly configService: ConfigService,
    private readonly supportService: SupportService,
    private readonly pollService: PollService,
    private readonly broadcastService: BroadcastService,
    private readonly subscriptionService: SubscriptionService,
    private readonly scheduleCommandService: ScheduleCommandService,
    private readonly userHelperService: UserHelperService,
    private readonly textHandlerService: TextHandlerService,
    private readonly yearEndBroadcastService: YearEndBroadcastService,
    private readonly referralService: ReferralService,
    private readonly analyticsService: AnalyticsService,
    private readonly groqService: GroqService,
    private readonly aiLimitService: AiLimitService,
    private readonly aiSubscriptionService: AiSubscriptionService,
    private readonly formatLimitClient: FormatLimitClient,
    @InjectRepository(UserAiContext)
    private readonly aiContextRepository: Repository<UserAiContext>,
    @InjectRepository(UserAiPayment)
    private readonly aiPaymentRepository: Repository<UserAiPayment>,
  ) {}

  private getRefundCheckoutClient(): YooCheckout | null {
    const shopId = this.configService.get<string>('YOOKASSA_SHOP_ID');
    const secretKey = this.configService.get<string>('YOOKASSA_SECRET_KEY');
    if (!shopId || !secretKey) return null;
    return new YooCheckout({ shopId, secretKey });
  }

  private getRefundWindowMs(): number {
    const days = this.configService.get<number>('AI_PLUS_REFUND_WINDOW_DAYS');
    if (days && days > 0) return days * 24 * 60 * 60 * 1000;
    const minutes = this.configService.get<number>(
      'AI_PLUS_REFUND_GRACE_MINUTES',
      60,
    );
    return minutes * 60 * 1000;
  }

  private isRefundRequireUnused(): boolean {
    const v = this.configService.get<string>(
      'AI_PLUS_REFUND_REQUIRE_UNUSED',
      '1',
    );
    return v !== '0' && v.toLowerCase() !== 'false';
  }

  private async getUserInfoForAdmin(user: User): Promise<string> {
    const name =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Пользователь';
    const username = user.username ? `@${user.username}` : 'нет username';

    let info = `👤 <b>Пользователь:</b> ${escapeHtml(name)} (${escapeHtml(username)})\n`;
    info += `🆔 <b>Chat ID:</b> <code>${escapeHtml(user.chatId)}</code>\n`;

    if (user.preferredGroup) {
      info += `📚 <b>Выбранная группа:</b> ${escapeHtml(user.preferredGroup)}\n`;
    }

    try {
      const subscriptions = await this.subscriptionRepository.find({
        where: {
          user: { id: user.id },
          isActive: true,
        },
      });

      if (subscriptions && subscriptions.length > 0) {
        const groups = subscriptions.map((s) => s.groupName).join(', ');
        info += `🔔 <b>Подписки на уведомления:</b> ${groups}\n`;
      }
    } catch (e) {
      this.logger.error('Error fetching subscriptions for user info', e);
    }

    return info;
  }

  private addFooterLinks(
    message: string,
    parseMode: 'Markdown' | 'HTML' = 'HTML',
  ): string {
    return message + getFooterLinks(parseMode);
  }

  private async replyWithFooter(
    ctx: Context,
    message: string,
    extra: any = {},
  ): Promise<any> {
    const parseMode = extra.parse_mode || 'HTML';
    const messageWithFooter = this.addFooterLinks(message, parseMode);
    return ctx.reply(messageWithFooter, {
      parse_mode: parseMode,
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  }

  private sanitizeDocxFileName(fileName: string | undefined): string {
    const base = (fileName || 'document.docx').replace(
      /[^\w.\-а-яА-ЯёЁ]/g,
      '_',
    );
    return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
  }

  @Command('logs')
  async onLogs(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) return;

    const logs = await this.redis.lrange('app:logs', 0, 99);
    if (!logs || logs.length === 0) {
      await ctx.reply('Logs are empty.');
      return;
    }

    const formattedLogs = logs
      .map((l) => {
        try {
          const j = JSON.parse(l);
          return `[${j.timestamp}] [${j.level.toUpperCase()}] [${j.context}] ${j.message}`;
        } catch {
          return l;
        }
      })
      .join('\n');

    if (formattedLogs.length > 4000) {
      const buffer = Buffer.from(formattedLogs);
      await ctx.replyWithDocument({ source: buffer, filename: 'logs.txt' });
    } else {
      await ctx.reply(`Last 100 logs:\n\n${formattedLogs}`);
    }
  }

  @Command('exams')
  async onExams(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);
    await this.scheduleCommandService.handleExams(ctx, user.id, 0);
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const user = ctx.from;
    if (!user || !ctx.chat) return;

    const dbUser = await this.userHelperService.getUser(ctx);
    let referralProcessed = false;

    const startPayload = (ctx as any).startPayload;
    if (startPayload) {
      if (dbUser.picture) {
        referralProcessed = true;
        await this.replyWithFooter(
          ctx,
          '⚠️ Вы уже пользовались мини-приложением ранее. Реферальные коды можно применять только при первом использовании бота.',
        );
      } else {
        const referrerUser = await this.userRepository.findOne({
          where: { chatId: startPayload },
        });

        if (referrerUser && referrerUser.id !== dbUser.id) {
          const hasReferral = await this.referralService.hasReferral(dbUser.id);
          if (!hasReferral) {
            const referral = await this.referralService.createReferralByUserId(
              referrerUser.id,
              dbUser.id,
            );
            if (referral) {
              referralProcessed = true;
              const referralMessage =
                '🎉 Вы были приглашены по реферальной ссылке!\n\n' +
                '✅ Вы получили +5 просмотров к вашему ежемесячному лимиту статистики.\n' +
                '📊 Пригласивший вас пользователь получил +10 просмотров к своему лимиту.\n\n' +
                'Спасибо за использование ysturasp!';

              const referralButtons = [
                [
                  Markup.button.url(
                    'Открыть приложение',
                    'https://t.me/ysturasp_bot/ysturasp_webapp',
                  ),
                ],
              ];

              await this.replyWithFooter(ctx, referralMessage, {
                ...getMainKeyboard(),
                ...Markup.inlineKeyboard(referralButtons),
              });
            } else {
              this.logger.debug(
                `Failed to create referral from ${referrerUser.id} to ${dbUser.id}`,
              );
            }
          } else {
            referralProcessed = true;
            await this.replyWithFooter(
              ctx,
              'ℹ️ Вы уже были приглашены по реферальной ссылке ранее.',
            );
          }
        } else if (referrerUser && referrerUser.id === dbUser.id) {
          referralProcessed = true;
          await this.replyWithFooter(
            ctx,
            '⚠️ Вы не можете пригласить самого себя по реферальной ссылке.',
          );
        } else if (!referrerUser) {
          referralProcessed = true;
          await this.replyWithFooter(
            ctx,
            '⚠️ Реферальная ссылка недействительна. Пользователь, который вас пригласил, не найден.',
          );
        }
      }
    }

    if (referralProcessed) {
      dbUser.stateData = { backTarget: 'main' };
      await this.userRepository.save(dbUser);
      return;
    }

    dbUser.state = null;
    dbUser.stateData = { backTarget: 'main' };
    await this.userRepository.save(dbUser);

    const escapeHtml = (unsafe: string) =>
      unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let message = `👋 Привет, ${escapeHtml(user.first_name)}! это ysturasp бот`;

    const mainButtons = [
      [Markup.button.callback('📩 Отправить проблему', 'open_support:main')],
      [Markup.button.callback('💡 Предложить идею', 'open_suggestion:main')],
      [Markup.button.callback('👤 Профиль', 'open_profile')],
      [Markup.button.callback('📄 Форматировать DOCX', 'open_format_help')],
      [
        Markup.button.callback('🔔 Подписаться', 'open_subscribe:main'),
        Markup.button.callback('❌ Отписаться', 'open_unsubscribe'),
      ],
      [
        Markup.button.callback(
          '⭐ Поддержать звездами',
          'open_support_stars:main',
        ),
      ],
      [
        Markup.button.url(
          'Открыть приложение',
          'https://t.me/ysturasp_bot/ysturasp_webapp',
        ),
      ],
    ];

    if (dbUser.isAdmin) {
      mainButtons.push(
        [
          Markup.button.callback('🛠️ Создать опрос', 'open_createpoll'),
          Markup.button.callback('📢 Рассылка', 'open_broadcast'),
        ],
        [
          Markup.button.callback('📊 Аналитика', 'open_analytics'),
          Markup.button.callback('🤖 Статистика ИИ', 'ai_stats'),
        ],
      );
    }

    message += `\n\n📚 ты можешь просто ввести:
- название группы (например, ЦИС-33)
- фио преподавателя (например, Иванов И.И.)
- номер аудитории (например, 633)

или выбрать необходимое действие в меню ниже, чтобы посмотреть расписание или подписаться на уведомления

💬 Также у нас есть телеграм-канал с новостями и обновлениями — @ysturasp`;

    await ctx.reply(message, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...getMainKeyboard(),
      ...Markup.inlineKeyboard(mainButtons),
    });
  }

  @Command('reset')
  async onReset(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.aiContextRepository.delete({ user: { id: user.id } as any });
    await ctx.reply('🧹 Контекст общения с ИИ очищен.');
  }

  @Command('ai_stats')
  async onAiStats(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) return;

    const stats = await this.groqService.getPoolStats();
    const userCount = await this.userRepository.count();
    const requiredMinKeys =
      await this.groqService.getRequiredMinKeys(userCount);

    const message =
      `📊 <b>Статистика ИИ:</b>\n\n` +
      `🔑 Ключей всего: <b>${stats.totalKeys}</b>\n` +
      `✅ Активных: <b>${stats.activeKeys}</b>\n` +
      `📋 Рекомендуемый минимум: <b>${requiredMinKeys}</b> (для ${userCount} польз.)\n` +
      `🚫 Лимиты исчерпаны: <b>${stats.limitedKeys}</b>\n\n` +
      `✨ Использовано токенов: <b>${stats.totalTokens.toLocaleString('ru-RU')}</b>\n` +
      `💬 Всего запросов к ИИ: <b>${stats.totalRequests}</b>\n\n` +
      (stats.soonestReset
        ? `⏳ Ближайший сброс лимитов: <b>${stats.soonestReset.toLocaleTimeString('ru-RU')}</b>`
        : `🚀 Все ключи готовы к работе!`);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Проверить ключи', 'ai_check_keys')],
      [Markup.button.callback('➕ Добавить ключ(и)', 'ai_add_keys')],
    ]);

    await this.replyWithFooter(ctx, message, keyboard as any);
  }

  @Command('ai_add_key')
  async onAiAddKeyCommand(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('Доступно только администраторам');
      return;
    }
    user.state = 'WAITING_AI_KEYS';
    user.stateData = null;
    await this.userRepository.save(user);
    await ctx.reply(
      'Отправьте один или несколько ключей Groq (каждый с новой строки или через запятую).\nДля отмены: /cancel',
    );
  }

  @Action('ai_add_keys')
  async onAiAddKeysAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) return;
    user.state = 'WAITING_AI_KEYS';
    user.stateData = null;
    await this.userRepository.save(user);
    await ctx.reply(
      'Отправьте один или несколько ключей Groq (каждый с новой строки или через запятую).\nДля отмены: /cancel',
    );
  }

  @Command('ai_check_keys')
  async onAiCheckKeys(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('Доступно только администраторам');
      return;
    }

    await ctx.reply('⏳ Проверяю ключи Groq...');

    const results = await this.groqService.checkAllKeysHealth();

    if (!results.length) {
      await ctx.reply('🔍 Ключи Groq не найдены в базе.');
      return;
    }

    const lines: string[] = ['🔍 <b>Проверка ключей Groq</b>', ''];
    for (const r of results) {
      const statusLabel = !r.isActive
        ? '🚫 деактивирован'
        : r.ok
          ? '✅ OK'
          : '❌ ошибка';
      const statusCode = r.status ? ` (HTTP ${r.status})` : '';
      lines.push(
        `• <code>${r.keyPrefix}******</code>: ${statusLabel}${statusCode}${
          r.error ? ` — ${r.error}` : ''
        }`,
      );
    }

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
    } as any);
  }

  @Action('ai_check_keys')
  async onAiCheckKeysAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.onAiCheckKeys(ctx);
  }

  @Action('ai_stats')
  async onAiStatsAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.onAiStats(ctx);
  }

  @Command('profile')
  async onProfile(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.renderProfile(ctx, user);
  }

  @Action('open_profile')
  async onOpenProfile(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);
    await this.renderProfile(ctx, user);
  }

  private async renderProfile(ctx: Context, user: User): Promise<void> {
    await this.aiLimitService.checkAndResetLimits(user);

    const remaining = await this.aiLimitService.getRemainingRequests(user);
    const limit = await this.aiLimitService.getMonthlyLimit(user);
    const resetDate = await this.aiLimitService.getNextResetDate(user);
    const model = user.aiModel || 'llama-3.3-70b-versatile';
    const plusSub =
      await this.aiSubscriptionService.getActiveSubscription(user);
    const planLabel = plusSub
      ? `Plus (до ${plusSub.expiresAt.toLocaleDateString('ru-RU')})`
      : 'Free';

    const rows: any[] = [
      [
        Markup.button.callback('⚙️ Модель', 'profile_mode'),
        Markup.button.callback('🧹 Сброс контекста', 'profile_reset'),
      ],
    ];
    if (plusSub) {
      rows.push([
        Markup.button.callback('⚙️ Управление AI Plus', 'open_ai_plus_manage'),
      ]);
    } else {
      rows.push([
        Markup.button.callback('⬆️ Улучшить тариф (AI Plus)', 'open_ai_plus'),
      ]);
    }
    rows.push([Markup.button.callback('« Назад', 'back_to_main_profile')]);

    const message =
      `👤 <b>Ваш профиль:</b>\n` +
      `🆔 ID: <code>${user.chatId}</code>\n` +
      `💳 Тариф: <b>${planLabel}</b>\n\n` +
      `🤖 Модель: <code>${model}</code>\n` +
      `⏳ Осталось запросов: <b>${remaining}/${limit}</b>\n` +
      `📅 Сброс лимитов: <b>${resetDate.toLocaleDateString('ru-RU')}</b>`;

    const keyboard = Markup.inlineKeyboard(rows);

    const parseMode: 'HTML' = 'HTML';
    const textWithFooter = this.addFooterLinks(message, parseMode);
    const isCallback = !!ctx.callbackQuery;

    try {
      if (isCallback) {
        await ctx.editMessageText(textWithFooter, {
          parse_mode: parseMode,
          link_preview_options: { is_disabled: true },
          ...keyboard,
        } as any);
      } else {
        await ctx.reply(textWithFooter, {
          parse_mode: parseMode,
          link_preview_options: { is_disabled: true },
          ...keyboard,
        });
      }
    } catch {
      await this.replyWithFooter(ctx, message, keyboard as any);
    }
  }

  @Action('profile_mode')
  async onProfileMode(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.onMode(ctx);
  }

  @Action('profile_reset')
  async onProfileReset(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);
    await this.aiContextRepository.delete({ user: { id: user.id } as any });
    await this.renderProfile(ctx, user);
    await ctx.answerCbQuery('Контекст очищен');
  }

  @Action('back_to_main_profile')
  async onBackToMainProfile(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);

    const fromUser = ctx.from;
    const dbUser = user;

    let message = `👋 Привет, ${fromUser?.first_name || ''}! это ysturasp бот`;

    const mainButtons = [
      [Markup.button.callback('📩 Отправить проблему', 'open_support:main')],
      [Markup.button.callback('💡 Предложить идею', 'open_suggestion:main')],
      [Markup.button.callback('👤 Профиль', 'open_profile')],
      [Markup.button.callback('📄 Форматировать DOCX', 'open_format_help')],
      [
        Markup.button.callback('🔔 Подписаться', 'open_subscribe:main'),
        Markup.button.callback('❌ Отписаться', 'open_unsubscribe'),
      ],
      [
        Markup.button.callback(
          '⭐ Поддержать звездами',
          'open_support_stars:main',
        ),
      ],
      [
        Markup.button.url(
          'Открыть приложение',
          'https://t.me/ysturasp_bot/ysturasp_webapp',
        ),
      ],
    ];

    if (dbUser.isAdmin) {
      mainButtons.push(
        [
          Markup.button.callback('🛠️ Создать опрос', 'open_createpoll'),
          Markup.button.callback('📢 Рассылка', 'open_broadcast'),
        ],
        [Markup.button.callback('📊 Аналитика', 'open_analytics')],
      );
    }

    message += `\n\nТакже вы можете просто ввести название группы (например, ЦИС-33), чтобы посмотреть расписание или подписаться на уведомления.`;

    const keyboard = Markup.inlineKeyboard(mainButtons);
    const isCallback = !!ctx.callbackQuery;
    try {
      if (isCallback) {
        await ctx.editMessageText(message, keyboard as any);
      } else {
        await ctx.reply(message, keyboard as any);
      }
    } catch {
      await this.replyWithFooter(ctx, message, keyboard as any);
    }
  }

  @Command('plus_manage')
  async onPlusManage(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.renderPlusManage(ctx, user);
  }

  @Action('open_ai_plus_manage')
  async onOpenAiPlusManage(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);
    await this.renderPlusManage(ctx, user);
  }

  @Action(/^ai_plus_refund_confirm:(.+)$/)
  async onAiPlusRefundConfirm(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    // @ts-ignore
    const paymentId = ctx.match[1];
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '✅ Подтвердить возврат',
          `ai_plus_refund_do:${paymentId}`,
        ),
      ],
      [Markup.button.callback('Отмена', 'ai_plus_refund_cancel')],
    ]);
    await ctx.reply(
      '⚠️ Подтвердите возврат.\n\n' +
        'Отмена с возвратом возможна только если подписка не использовалась и вы уложились в окно возврата.',
      kb,
    );
  }

  @Action('ai_plus_refund_cancel')
  async onAiPlusRefundCancel(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Ок');
  }

  private async renderPlusManage(ctx: Context, user: User): Promise<void> {
    const plusSub =
      await this.aiSubscriptionService.getActiveSubscription(user);

    if (!plusSub) {
      const text = 'ℹ️ У вас нет активной подписки <b>AI Plus</b>.';
      const isCallback = !!ctx.callbackQuery;
      const parseMode: 'HTML' = 'HTML';
      const withFooter = this.addFooterLinks(text, parseMode);
      try {
        if (isCallback) {
          await ctx.editMessageText(withFooter, {
            parse_mode: parseMode,
            link_preview_options: { is_disabled: true },
          } as any);
        } else {
          await ctx.reply(withFooter, {
            parse_mode: parseMode,
            link_preview_options: { is_disabled: true },
          });
        }
      } catch {
        await this.replyWithFooter(ctx, text);
      }
      return;
    }

    const refundWindowMs = this.getRefundWindowMs();
    const refundRequireUnused = this.isRefundRequireUnused();
    const now = new Date();

    const lastPayment = await this.aiPaymentRepository.findOne({
      where: {
        user: { id: user.id } as any,
        payload: 'ai_plus_1m',
        status: 'succeeded',
      },
      order: { createdAt: 'DESC' },
      relations: ['user'],
    });

    const usage = await this.aiLimitService.getUsageSnapshot(user);
    const isWithinGrace =
      !!lastPayment &&
      now.getTime() - lastPayment.createdAt.getTime() <= refundWindowMs;
    const isUnused =
      !!lastPayment &&
      usage.monthlyCount === lastPayment.usageMonthlyCountAtPurchase &&
      usage.weeklyCount === lastPayment.usageWeeklyCountAtPurchase;
    const isSameSubscription =
      !!lastPayment && lastPayment.subscriptionId === plusSub.id;

    const refundClient = this.getRefundCheckoutClient();
    const refundAvailable = !!refundClient;

    const canRefund =
      refundAvailable &&
      !!lastPayment &&
      !!lastPayment.providerPaymentChargeId &&
      isSameSubscription &&
      isWithinGrace &&
      (!refundRequireUnused || isUnused);

    const lines: string[] = [
      `💳 <b>AI Plus</b>`,
      `Действует до: <b>${plusSub.expiresAt.toLocaleDateString('ru-RU')}</b>`,
      '',
      `Лимит: <b>200 запросов/месяц</b> (не суммируется при повторной покупке).`,
      '',
      `Возврат платежа: в течение заданного окна после оплаты${
        refundRequireUnused
          ? ' и только если после оплаты не было запросов к ИИ'
          : ''
      }.`,
    ];

    if (!refundAvailable) {
      lines.push('', 'ℹ️ Возврат недоступен: не настроены ключи ЮKassa API.');
    } else if (!lastPayment) {
      lines.push('', 'ℹ️ Не нашёл платёж AI Plus для возврата.');
    } else if (!isSameSubscription) {
      lines.push(
        '',
        'ℹ️ Возврат доступен только для последней покупки (продления).',
      );
    } else if (!isWithinGrace) {
      lines.push('', 'ℹ️ Окно возврата уже прошло.');
    } else if (refundRequireUnused && !isUnused) {
      lines.push(
        '',
        'ℹ️ После оплаты уже были запросы к ИИ — возврат недоступен.',
      );
    } else if (!lastPayment.providerPaymentChargeId) {
      lines.push('', 'ℹ️ Не удалось определить payment_id для возврата.');
    } else {
      lines.push('', '✅ Возврат доступен: подписка не использовалась.');
    }

    const kbRows: any[] = [];
    if (canRefund) {
      kbRows.push([
        Markup.button.callback(
          '❌ Отменить подписку и вернуть деньги',
          `ai_plus_refund_confirm:${lastPayment!.id}`,
        ),
      ]);
    }
    kbRows.push([Markup.button.callback('« Назад', 'open_profile')]);

    const keyboard = Markup.inlineKeyboard(kbRows);

    const parseMode: 'HTML' = 'HTML';
    const withFooter = this.addFooterLinks(lines.join('\n'), parseMode);
    const isCallback = !!ctx.callbackQuery;
    try {
      if (isCallback) {
        await ctx.editMessageText(withFooter, {
          parse_mode: parseMode,
          link_preview_options: { is_disabled: true },
          ...keyboard,
        } as any);
      } else {
        await ctx.reply(withFooter, {
          parse_mode: parseMode,
          link_preview_options: { is_disabled: true },
          ...keyboard,
        });
      }
    } catch {
      await this.replyWithFooter(ctx, lines.join('\n'), keyboard as any);
    }
  }

  @Action(/^ai_plus_refund_do:(.+)$/)
  async onAiPlusRefundDo(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('⏳ Оформляю возврат...');
    // @ts-ignore
    const paymentId = ctx.match[1];
    const user = await this.userHelperService.getUser(ctx);

    const paymentRow = await this.aiPaymentRepository.findOne({
      where: { id: paymentId, user: { id: user.id } as any },
      relations: ['user'],
    });

    if (!paymentRow || paymentRow.payload !== 'ai_plus_1m') {
      await ctx.reply('❌ Платёж не найден.');
      return;
    }
    if (paymentRow.status !== 'succeeded') {
      await ctx.reply(
        'ℹ️ Этот платёж уже возвращён или недоступен для возврата.',
      );
      return;
    }

    const refundWindowMs = this.getRefundWindowMs();
    const refundRequireUnused = this.isRefundRequireUnused();
    const now = new Date();
    if (now.getTime() - paymentRow.createdAt.getTime() > refundWindowMs) {
      await ctx.reply('❌ Окно возврата уже прошло.');
      return;
    }

    const plusSub =
      await this.aiSubscriptionService.getActiveSubscription(user);
    if (
      !plusSub ||
      !paymentRow.subscriptionId ||
      paymentRow.subscriptionId !== plusSub.id
    ) {
      await ctx.reply('❌ Возврат доступен только для последней покупки.');
      return;
    }

    const usage = await this.aiLimitService.getUsageSnapshot(user);
    const isUnused =
      usage.monthlyCount === paymentRow.usageMonthlyCountAtPurchase &&
      usage.weeklyCount === paymentRow.usageWeeklyCountAtPurchase;
    if (refundRequireUnused && !isUnused) {
      await ctx.reply(
        '❌ После оплаты уже были запросы к ИИ — возврат недоступен.',
      );
      return;
    }

    const checkout = this.getRefundCheckoutClient();
    if (!checkout) {
      await ctx.reply('❌ Самовозврат не настроен (нет ключей ЮKassa API).');
      return;
    }
    if (!paymentRow.providerPaymentChargeId) {
      await ctx.reply('❌ Не удалось определить payment_id для возврата.');
      return;
    }

    const amountValue = (paymentRow.amountKops / 100).toFixed(2);
    const refundPayload: ICreateRefund = {
      payment_id: paymentRow.providerPaymentChargeId,
      amount: {
        value: amountValue,
        currency: paymentRow.currency || 'RUB',
      },
    };
    const idempotenceKey = paymentRow.id || crypto.randomUUID();

    try {
      const refund = await checkout.createRefund(refundPayload, idempotenceKey);
      paymentRow.status = 'refunded';
      paymentRow.refundId = (refund as any).id || null;
      paymentRow.refundedAt = new Date();
      paymentRow.refundError = null;
      await this.aiPaymentRepository.save(paymentRow);

      await this.aiSubscriptionService.markSubscriptionRefunded(plusSub.id);
      const activeAfter =
        await this.aiSubscriptionService.getActiveSubscription(user);

      await ctx.reply(
        '✅ Отмена оформлена, возврат отправлен в ЮKassa.\n\n' +
          (activeAfter
            ? `AI Plus останется активной до ${activeAfter.expiresAt.toLocaleDateString('ru-RU')}.\n`
            : 'AI Plus отключена.\n') +
          'Срок зачисления денег зависит от вашего банка.',
      );
    } catch (e: any) {
      paymentRow.status = 'refund_failed';
      paymentRow.refundError = e?.message || String(e);
      await this.aiPaymentRepository.save(paymentRow);
      this.logger.error('AI Plus refund failed', e);
      await ctx.reply(
        '❌ Не удалось оформить возврат. Попробуйте позже или напишите в поддержку.',
      );
    }
  }

  @Command('plus_cancel')
  async onPlusCancel(@Ctx() ctx: Context) {
    await this.onPlusManage(ctx);
  }

  @Command('mode')
  async onMode(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const currentModel = user.aiModel || 'llama-3.3-70b-versatile';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🧠 Reasoning', 'category:reasoning'),
        Markup.button.callback('⚡ Multi-purpose', 'category:multipurpose'),
      ],
      [
        Markup.button.callback('👁️ Vision', 'category:vision'),
        Markup.button.callback('🤖 Others', 'category:others'),
      ],
      [Markup.button.callback('« Назад', 'open_profile')],
    ]);

    const text =
      `🤖 <b>Выбор модели ИИ</b>\n\n` +
      `Текущая модель: <code>${currentModel}</code>\n\n` +
      `Выберите категорию:`;

    const isCallback = !!ctx.callbackQuery;
    try {
      if (isCallback) {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...keyboard,
        } as any);
      } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
      }
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  }

  @Action(/^category:(.+)$/)
  async onCategorySelect(@Ctx() ctx: Context) {
    // @ts-ignore
    const category = ctx.match[1];
    const user = await this.userHelperService.getUser(ctx);
    const currentModel = user.aiModel || 'llama-3.3-70b-versatile';

    let models = [];
    let title = '';

    if (category === 'reasoning') {
      title = '🧠 Модели для рассуждений (Reasoning):';
      models = [
        { name: 'GPT OSS 120B', id: 'openai/gpt-oss-120b' },
        { name: 'GPT OSS 20B', id: 'openai/gpt-oss-20b' },
        { name: 'Qwen 3 32B', id: 'qwen/qwen3-32b' },
      ];
    } else if (category === 'multipurpose') {
      title = '⚡ Универсальные модели:';
      models = [
        {
          name: 'Llama 4 Scout',
          id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        },
        { name: 'Kimi K2', id: 'moonshotai/kimi-k2-instruct' },
        { name: 'Llama 3.3 70B', id: 'llama-3.3-70b-versatile' },
      ];
    } else if (category === 'vision') {
      title = '👁️ Модели со зрением (Vision):';
      models = [
        {
          name: 'Llama 4 Maverick',
          id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        },
        {
          name: 'Llama 4 Scout',
          id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        },
      ];
    } else {
      title = '🤖 Другие модели:';
      models = [
        { name: 'Llama 3.1 8B', id: 'llama-3.1-8b-instant' },
        { name: 'Llama Guard 4', id: 'meta-llama/llama-guard-4-12b' },
      ];
    }

    const buttons = models.map((m) => [
      Markup.button.callback(
        `${m.name} ${currentModel === m.id ? '✅' : ''}`,
        `set_ai_model:${m.id}`,
      ),
    ]);
    buttons.push([Markup.button.callback('« Назад', 'back_to_categories')]);

    await ctx.editMessageText(title, Markup.inlineKeyboard(buttons));
  }

  @Action('back_to_categories')
  async onBackToCategories(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const currentModel = user.aiModel || 'llama-3.3-70b-versatile';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🧠 Reasoning', 'category:reasoning'),
        Markup.button.callback('⚡ Multi-purpose', 'category:multipurpose'),
      ],
      [
        Markup.button.callback('👁️ Vision', 'category:vision'),
        Markup.button.callback('🤖 Others', 'category:others'),
      ],
      [Markup.button.callback('« Назад', 'open_profile')],
    ]);

    await ctx.editMessageText(
      `🤖 <b>Выбор модели ИИ</b>\n\n` +
        `Текущая модель: <code>${currentModel}</code>\n\n` +
        `Выберите категорию:`,
      { parse_mode: 'HTML', ...keyboard },
    );
  }

  @Action(/^set_ai_model:(.+)$/)
  async onSetAiModel(@Ctx() ctx: Context) {
    // @ts-ignore
    const model = ctx.match[1];
    const user = await this.userHelperService.getUser(ctx);
    user.aiModel = model;
    await this.userRepository.save(user);

    await ctx.answerCbQuery(`Выбрана модель: ${model}`);
    await ctx.editMessageText(
      `✅ Модель ИИ изменена на: <code>${model}</code>`,
      {
        parse_mode: 'HTML',
      },
    );
  }

  @Command('subscribe')
  async onSubscribe(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    user.stateData = { backTarget: 'main' };
    await this.userRepository.save(user);
    await this.subscriptionService.handleSubscribe(ctx, user);
  }

  @Command('unsubscribe')
  async onUnsubscribe(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.subscriptionService.handleUnsubscribe(ctx, user);
  }

  @Action(/^unsubscribe:(\d+)$/)
  async onUnsubscribeAction(@Ctx() ctx: Context) {
    // @ts-ignore
    const subId = parseInt(ctx.match[1]);
    await this.subscriptionService.handleUnsubscribeAction(ctx, subId);
  }

  @Action(/^quick_sub:(.+)$/)
  async onQuickSubscribe(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    const user = await this.userHelperService.getUser(ctx);
    await this.subscriptionService.handleQuickSubscribe(ctx, user, groupName);
  }

  @Action(/^quick_view:(.+)$/)
  async onQuickView(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    await this.scheduleCommandService.handleQuickView(ctx, groupName);
  }

  @Action(/^quick_select_group:(.+)$/)
  async onQuickSelectGroup(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    const user = await this.userHelperService.getUser(ctx);
    await this.subscriptionService.handleQuickSelectGroup(ctx, user, groupName);
  }

  @Action(/^view_day:(.+):(\d+)$/)
  async onViewDay(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    // @ts-ignore
    const dayOffset = parseInt(ctx.match[2]);
    await this.scheduleCommandService.handleViewDay(ctx, groupName, dayOffset);
  }

  @Action(/^view_week:([^:]+)(?::(-?\d+))?$/)
  async onViewWeek(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    // @ts-ignore
    const offsetRaw = ctx.match[2];
    const weekOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : 0;
    await this.scheduleCommandService.handleViewWeek(
      ctx,
      groupName,
      weekOffset,
    );
  }

  @Action(/^quick_select_teacher:(\d+)(?::(.+))?$/)
  async onQuickSelectTeacher(@Ctx() ctx: Context) {
    // @ts-ignore
    const teacherId = parseInt(ctx.match[1], 10);
    // @ts-ignore
    const query = ctx.match[2];
    await this.scheduleCommandService.handleQuickSelectTeacher(
      ctx,
      teacherId,
      query,
    );
  }

  @Action(/^teacher_search:([^:]+)(?::(\d+))?$/)
  async onTeacherSearch(@Ctx() ctx: Context) {
    // @ts-ignore
    const query = ctx.match[1];
    // @ts-ignore
    const page = parseInt(ctx.match[2] || '0', 10);
    await this.scheduleCommandService.handleTeacherSearch(ctx, query, page);
  }

  @Action(/^quick_view_audience:(.+)$/)
  async onQuickViewAudience(@Ctx() ctx: Context) {
    // @ts-ignore
    const audienceId = ctx.match[1];
    await this.scheduleCommandService.handleQuickViewAudience(ctx, audienceId);
  }

  @Action(/^quick_select_audience:([^:]+)(?::(.+))?$/)
  async onQuickSelectAudience(@Ctx() ctx: Context) {
    // @ts-ignore
    const audienceId = ctx.match[1];
    // @ts-ignore
    const query = ctx.match[2];
    await this.scheduleCommandService.handleQuickSelectAudience(
      ctx,
      audienceId,
      query,
    );
  }

  @Action(/^audience_search:([^:]+)(?::(\d+))?$/)
  async onAudienceSearch(@Ctx() ctx: Context) {
    // @ts-ignore
    const query = ctx.match[1];
    // @ts-ignore
    const page = parseInt(ctx.match[2] || '0', 10);
    await this.scheduleCommandService.handleAudienceSearch(ctx, query, page);
  }

  @Action(/^view_teacher_day:(\d+):(\d+)(?::(.+))?$/)
  async onViewTeacherDay(@Ctx() ctx: Context) {
    // @ts-ignore
    const teacherId = parseInt(ctx.match[1], 10);
    // @ts-ignore
    const dayOffset = parseInt(ctx.match[2], 10);
    // @ts-ignore
    const query = ctx.match[3];
    await this.scheduleCommandService.handleTeacherDay(
      ctx,
      teacherId,
      dayOffset,
      query,
    );
  }

  @Action(/^view_teacher_week:(\d+)(?::(-?\d+))?(?::(.+))?$/)
  async onViewTeacherWeek(@Ctx() ctx: Context) {
    // @ts-ignore
    const teacherId = parseInt(ctx.match[1], 10);
    // @ts-ignore
    const offsetRaw = ctx.match[2];
    const weekOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : 0;
    // @ts-ignore
    const query = ctx.match[3];
    await this.scheduleCommandService.handleTeacherWeek(
      ctx,
      teacherId,
      weekOffset,
      query,
    );
  }

  @Action(/^view_audience_day:([^:]+):(\d+)(?::(.+))?$/)
  async onViewAudienceDay(@Ctx() ctx: Context) {
    // @ts-ignore
    const audienceId = ctx.match[1];
    // @ts-ignore
    const dayOffset = parseInt(ctx.match[2], 10);
    // @ts-ignore
    const query = ctx.match[3];
    await this.scheduleCommandService.handleAudienceDay(
      ctx,
      audienceId,
      dayOffset,
      query,
    );
  }

  @Action(/^view_audience_week:([^:]+)(?::(-?\d+))?(?::(.+))?$/)
  async onViewAudienceWeek(@Ctx() ctx: Context) {
    // @ts-ignore
    const audienceId = ctx.match[1];
    // @ts-ignore
    const offsetRaw = ctx.match[2];
    const weekOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : 0;
    // @ts-ignore
    const query = ctx.match[3];
    await this.scheduleCommandService.handleAudienceWeek(
      ctx,
      audienceId,
      weekOffset,
      query,
    );
  }

  @Action(/^back_to_group:(.+)$/)
  async onBackToGroup(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    const user = await this.userHelperService.getUser(ctx);
    await this.scheduleCommandService.handleBackToGroup(ctx, user, groupName);
  }

  @Action(/^schedule_day:(\d+)$/)
  async onScheduleDay(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    // @ts-ignore
    const dayOffset = parseInt(ctx.match[1], 10);
    const user = await this.userHelperService.getUser(ctx);
    await this.scheduleCommandService.handleScheduleRequest(
      ctx,
      user.id,
      dayOffset,
    );
  }

  @Action('schedule_week')
  async onScheduleWeek(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);
    await this.scheduleCommandService.handleScheduleRequest(
      ctx,
      user.id,
      'week',
    );
  }

  @Action('show_exams')
  async onShowExams(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);
    await this.scheduleCommandService.handleExams(ctx, user.id, 0);
  }

  @Action(/^view_exams:(.+):(\d+)$/)
  async onViewExams(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    // @ts-ignore
    const userId = ctx.match[1];
    // @ts-ignore
    const groupIndex = parseInt(ctx.match[2]);
    await this.scheduleCommandService.handleExams(ctx, userId, groupIndex);
  }

  @Action('back_to_schedule_menu')
  async onBackToScheduleMenu(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📅 Сегодня', 'schedule_day:0')],
      [Markup.button.callback('📅 Завтра', 'schedule_day:1')],
      [Markup.button.callback('📅 Неделя', 'schedule_week')],
      [Markup.button.callback('📝 Экзамены', 'show_exams')],
    ]);

    await ctx.editMessageText('Выберите, что хотите посмотреть:', keyboard);
  }

  @Action('manage_subs')
  async onManageSubs(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    user.stateData = { backTarget: 'settings' };
    await this.userRepository.save(user);
    await ctx.answerCbQuery();
    await this.subscriptionService.handleSubscriptions(ctx, user);
  }

  @Action('open_unsubscribe')
  async onOpenUnsubscribe(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    await this.subscriptionService.handleUnsubscribeFromSettings(ctx, user);
  }

  @Action(/^open_subscribe(?::(.+))?$/)
  async onOpenSubscribe(@Ctx() ctx: Context) {
    // @ts-ignore
    const source = ctx.match?.[1];
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (source === 'settings') {
      user.stateData = { backTarget: 'settings' };
      await this.userRepository.save(user);
    } else if (source === 'main') {
      user.stateData = { backTarget: 'main' };
      await this.userRepository.save(user);
    } else if (source === 'help') {
      user.stateData = { backTarget: 'help' };
      await this.userRepository.save(user);
    } else if (!user.stateData?.backTarget) {
      user.stateData = { backTarget: 'main' };
      await this.userRepository.save(user);
    }
    await this.subscriptionService.handleSubscribeFromSettings(ctx, user);
  }

  @Action(/^open_support(?::(.+))?$/)
  async onOpenSupport(@Ctx() ctx: Context) {
    // @ts-ignore
    const source = ctx.match?.[1];
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (source === 'settings') {
      user.stateData = { backTarget: 'settings' };
      await this.userRepository.save(user);
    } else if (source === 'main') {
      user.stateData = { backTarget: 'main' };
      await this.userRepository.save(user);
    } else if (source === 'help') {
      user.stateData = { backTarget: 'help' };
      await this.userRepository.save(user);
    }
    await this.supportService.handleSupportCommand(ctx, user);
    await this.userRepository.save(user);
  }

  @Action('open_createpoll')
  async onOpenCreatePoll(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта функция доступна только администраторам.');
      return;
    }
    user.stateData = { backTarget: user.stateData?.backTarget || 'main' };
    await this.userRepository.save(user);
    await this.pollService.handleCreatePollCommand(ctx, user);
  }

  @Action('open_broadcast')
  async onOpenBroadcast(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (!user.isAdmin) {
      await this.replyWithFooter(
        ctx,
        '❌ Эта функция доступна только администраторам.',
      );
      return;
    }
    user.state = 'BROADCAST';
    user.stateData = { backTarget: user.stateData?.backTarget || 'main' };
    await this.userRepository.save(user);
    const kb2 = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);
    const isCallback2 =
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery;
    if (isCallback2) {
      try {
        await ctx.editMessageText(
          'Отправьте текст для рассылки, фото/видео/кружок/стикер/голосовое с подписью (где доступно).\n\nЧтобы исключить пользователей, первой строкой напишите:\n<code>!except user1, 123456</code>\n(далее — текст рассылки). Указать можно @username или chat id. Без этой строки рассылка пойдёт всем.',
          { ...(kb2 as any), parse_mode: 'HTML' },
        );
        return;
      } catch (e) {}
    }
    await this.replyWithFooter(
      ctx,
      'Отправьте текст для рассылки, фото/видео/кружок/стикер/голосовое с подписью (где доступно).\n\nЧтобы исключить пользователей, первой строкой напишите:\n<code>!except user1, 123456</code>\n(далее — текст рассылки). Указать можно @username или chat id. Без этой строки рассылка пойдёт всем.',
      { ...(kb2 as any), parse_mode: 'HTML' },
    );
  }

  @Action('open_analytics')
  async onOpenAnalytics(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (!user.isAdmin) {
      await this.replyWithFooter(
        ctx,
        '❌ Эта функция доступна только администраторам.',
      );
      return;
    }
    await this.onAnalytics(ctx);
  }

  @Action(/^open_suggestion(?::(.+))?$/)
  async onOpenSuggestion(@Ctx() ctx: Context) {
    // @ts-ignore
    const source = ctx.match?.[1];
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (source === 'settings') {
      user.stateData = { backTarget: 'settings' };
      await this.userRepository.save(user);
    } else if (source === 'main') {
      user.stateData = { backTarget: 'main' };
      await this.userRepository.save(user);
    }
    await this.supportService.handleSuggestionCommand(ctx, user);
    await this.userRepository.save(user);
  }

  @Action(/^open_support_stars(?::(.+))?$/)
  async onOpenSupportStars(@Ctx() ctx: Context) {
    // @ts-ignore
    const source = ctx.match?.[1];
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (source === 'settings') {
      user.stateData = { backTarget: 'settings' };
      await this.userRepository.save(user);
    } else if (source === 'main') {
      user.stateData = { backTarget: 'main' };
      await this.userRepository.save(user);
    }
    await this.onSupportStars(ctx);
  }

  @Action('open_format_help')
  async onOpenFormatHelp(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const user = await this.userHelperService.getUser(ctx);
    const limit = await this.formatLimitClient.checkLimit(user.id, true);
    const remaining = limit.remaining ?? 0;
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '💳 Купить 10 форматирований',
          'open_format_buy',
        ),
      ],
    ]);

    await this.replyWithFooter(
      ctx,
      `📄 <b>Форматирование DOCX по ГОСТ</b>\n\n` +
        `Отправьте мне файл <code>.docx</code> в личный чат, и я верну отформатированную версию.\n\n` +
        `Остаток форматирований: <b>${remaining}</b>`,
      {
        parse_mode: 'HTML',
        ...keyboard,
      },
    );
  }

  @Action('open_format_buy')
  async onOpenFormatBuy(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.onFormatBuy(ctx);
  }

  @Action(/^check_format_payment:(.+)$/)
  async onCheckFormatPayment(@Ctx() ctx: Context) {
    await ctx.answerCbQuery(
      'Покупка форматирований теперь через встроенную оплату Telegram. Используйте /format_buy.',
    );
  }

  @Action('open_set_default')
  async onOpenSetDefault(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    await this.subscriptionService.handleOpenSetDefault(ctx, user);
  }

  @Action(/^open_select_group(?::(.+))?$/)
  async onOpenSelectGroup(@Ctx() ctx: Context) {
    // @ts-ignore
    const source = ctx.match?.[1];
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    if (source === 'settings') {
      user.stateData = { backTarget: 'settings' };
      await this.userRepository.save(user);
    } else if (source === 'main') {
      user.stateData = { backTarget: 'main' };
      await this.userRepository.save(user);
    } else if (!user.stateData?.backTarget) {
      user.stateData = { backTarget: 'main' };
      await this.userRepository.save(user);
    }
    await this.subscriptionService.handleSelectGroupForView(ctx, user);
  }

  @Action(/^set_default:(\d+)$/)
  async onSetDefault(@Ctx() ctx: Context) {
    // @ts-ignore
    const subId = parseInt(ctx.match[1]);
    const user = await this.userHelperService.getUser(ctx);
    await this.subscriptionService.handleSetDefault(ctx, user, subId);
  }

  @Action('back_dynamic')
  async onBackDynamic(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    const backTarget = user.stateData?.backTarget || 'main';
    user.state = null;
    user.stateData = user.stateData ? { backTarget } : null;
    await this.userRepository.save(user);
    if (backTarget === 'settings') {
      await this.subscriptionService.handleSubscriptions(ctx, user);
    } else if (backTarget === 'help') {
      const helpButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🔔 Подписаться на группу',
            'open_subscribe:help',
          ),
        ],
        [
          Markup.button.callback(
            '💬 Написать в поддержку',
            'open_support:help',
          ),
        ],
      ]);
      try {
        await ctx.editMessageText(this.textHandlerService.getHelpMessage(), {
          parse_mode: 'Markdown',
          ...helpButtons,
        } as any);
      } catch (e) {
        await this.replyWithFooter(
          ctx,
          this.textHandlerService.getHelpMessage(),
          {
            ...getMainKeyboard(),
            ...helpButtons,
          },
        );
      }
    } else if (backTarget === 'main') {
      const fromUser = ctx.from;
      const dbUser = user;

      let message = `👋 Привет, ${fromUser?.first_name || ''}! это ysturasp бот`;

      const mainButtons = [
        [Markup.button.callback('📩 Отправить проблему', 'open_support:main')],
        [Markup.button.callback('💡 Предложить идею', 'open_suggestion:main')],
        [Markup.button.callback('👤 Профиль', 'open_profile')],
        [Markup.button.callback('📄 Форматировать DOCX', 'open_format_help')],
        [
          Markup.button.callback('🔔 Подписаться', 'open_subscribe:main'),
          Markup.button.callback('❌ Отписаться', 'open_unsubscribe'),
        ],
        [
          Markup.button.callback(
            '⭐ Поддержать звездами',
            'open_support_stars:main',
          ),
        ],
        [
          Markup.button.url(
            'Открыть приложение',
            'https://t.me/ysturasp_bot/ysturasp_webapp',
          ),
        ],
      ];

      if (dbUser.isAdmin) {
        mainButtons.push(
          [
            Markup.button.callback('🛠️ Создать опрос', 'open_createpoll'),
            Markup.button.callback('📢 Рассылка', 'open_broadcast'),
          ],
          [Markup.button.callback('📊 Аналитика', 'open_analytics')],
        );
      }

      message += `\n\nТакже вы можете просто ввести название группы (например, ЦИС-33), чтобы посмотреть расписание или подписаться на уведомления.`;

      try {
        await ctx.editMessageText(
          message,
          Markup.inlineKeyboard(mainButtons) as any,
        );
      } catch (e) {
        await this.replyWithFooter(ctx, message, {
          ...getMainKeyboard(),
          ...Markup.inlineKeyboard(mainButtons),
        } as any);
      }
    } else {
      await this.subscriptionService.handleSubscriptions(ctx, user);
    }
  }

  @Action(/^admin_reply:(.+)$/)
  async onAdminReply(@Ctx() ctx: Context) {
    // @ts-ignore
    const targetChatId = ctx.match[1];
    const admin = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    await this.supportService.prepareAdminReply(ctx, admin, targetChatId);
  }

  @Action('user_reply_to_admin')
  async onUserReplyToAdmin(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    user.state = 'SUPPORT';
    await this.userRepository.save(user);
    await this.replyWithFooter(ctx, '💬 Напишите ваш ответ поддержке:');
  }

  @Action('cancel_state')
  async onCancelState(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);

    await ctx.answerCbQuery();
    await ctx.editMessageText('✅ Операция отменена. Можете начать заново.');
  }

  @Command('subscriptions')
  async onSubscriptions(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    user.state = null;
    user.stateData = { backTarget: 'settings' };
    await this.userRepository.save(user);
    await this.subscriptionService.handleSubscriptions(ctx, user);
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const hadState = !!user.state;

    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);

    if (hadState) {
      await ctx.reply(
        '✅ Операция отменена. Можете начать заново.',
        getMainKeyboard(),
      );
    } else {
      await ctx.reply('Нечего отменять 🤷‍♂️', getMainKeyboard());
    }
  }

  @Command('support')
  async onSupport(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.supportService.handleSupportCommand(ctx, user);
    await this.userRepository.save(user);
  }

  @Command('suggestion')
  async onSuggestion(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.supportService.handleSuggestionCommand(ctx, user);
    await this.userRepository.save(user);
  }

  @Command('plus')
  async onPlus(@Ctx() ctx: Context) {
    const providerToken = this.configService.get<string>(
      'YOOKASSA_PROVIDER_TOKEN',
    );
    if (!providerToken) {
      await ctx.reply(
        '⚠️ Платежи через ЮKassa пока не настроены. Напишите в поддержку.',
      );
      return;
    }
    const priceKops = this.configService.get<number>(
      'AI_PLUS_PRICE_KOPS',
      39900,
    );
    await ctx.replyWithInvoice({
      title: 'AI Plus — подписка на 1 месяц',
      description:
        '• 200 запросов к ИИ в месяц вместо 50\n' +
        '• Те же модели (Llama, Groq и др.)\n' +
        '• Вторая покупка = продление срока подписки (лимит 200/мес не суммируется)\n' +
        '• Оплата раз в месяц, отмена в любой момент',
      payload: 'ai_plus_1m',
      provider_token: providerToken,
      currency: 'RUB',
      prices: [{ label: 'Подписка AI Plus (1 месяц)', amount: priceKops }],
    });
  }

  @Action('open_ai_plus')
  async onOpenAiPlus(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.onPlus(ctx);
  }

  @Command('format_limit')
  async onFormatLimit(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const limit = await this.formatLimitClient.checkLimit(user.id, true);
    if (!limit.can) {
      await ctx.reply(
        `⚠️ Форматирование сейчас недоступно.\nПричина: ${limit.reason || 'достигнут лимит'}\n\n` +
          `Чтобы увеличить лимит, используйте /format_buy`,
      );
      return;
    }
    await ctx.reply(
      `✅ Форматирование доступно.\nОсталось попыток: <b>${limit.remaining ?? 0}</b>`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('format_buy')
  async onFormatBuy(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const providerToken = this.configService.get<string>(
      'YOOKASSA_PROVIDER_TOKEN',
    );
    if (!providerToken) {
      await ctx.reply(
        '⚠️ Платежи через ЮKassa пока не настроены. Напишите в поддержку.',
      );
      return;
    }

    const priceKops = this.configService.get<number>(
      'FORMAT_10_PRICE_KOPS',
      85000,
    );

    await ctx.replyWithInvoice({
      title: '10 форматирований DOCX по ГОСТ',
      description:
        'Пакет из 10 форматирований документов DOCX по ГОСТ.\n' +
        'Форматирование доступно в личном чате бота. Остаток можно посмотреть командой /format_limit.',
      payload: 'format_10',
      provider_token: providerToken,
      currency: 'RUB',
      prices: [{ label: '10 форматирований', amount: priceKops }],
    });
  }

  @Command('support_stars')
  async onSupportStars(@Ctx() ctx: Context) {
    await ctx.replyWithInvoice({
      title: 'Поддержка бота',
      description: 'Поддержите развитие бота звездами Telegram',
      payload: 'support_stars',
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: 'Поддержка бота', amount: 100 }],
    });
  }

  @Command('createpoll')
  async onCreatePoll(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }
    await this.pollService.handleCreatePollCommand(ctx, user);
    await this.userRepository.save(user);
  }

  @Command('broadcast')
  async onBroadcast(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const msg = ctx.message as {
      text: string;
      entities?: import('telegraf/types').MessageEntity[];
    };
    const text = msg.text;
    const broadcastText = text.replace('/broadcast', '').trim();

    if (!broadcastText) {
      await ctx.reply(
        'Использование:\n/broadcast текст_сообщения\n\nЧтобы исключить пользователей, первой строкой напишите:\n!except user1, 123456\n(далее — текст рассылки)\n\nИли отправьте фото/видео/кружок/стикер/голосовое.',
      );
      return;
    }

    const parsed = parseBroadcastExclude(broadcastText);
    if (parsed.excludeIdentifiers.length && !parsed.text.trim()) {
      await ctx.reply(
        'Укажите текст рассылки после строки с исключениями (вторая строка и далее).',
      );
      return;
    }
    const startIndex = text.indexOf(broadcastText);
    let entities: import('telegraf/types').MessageEntity[] | undefined;
    if (startIndex >= 0 && msg.entities?.length) {
      const rawEntities = msg.entities
        .map((e) => ({ ...e, offset: e.offset - startIndex }))
        .filter(
          (e) => e.offset >= 0 && e.offset + e.length <= broadcastText.length,
        );
      if (parsed.entityOffsetShift > 0) {
        entities = rawEntities
          .filter(
            (e) =>
              e.offset >= parsed.entityOffsetShift &&
              e.offset + e.length <=
                parsed.entityOffsetShift + parsed.text.length,
          )
          .map((e) => ({
            ...e,
            offset: e.offset - parsed.entityOffsetShift,
          }));
      } else {
        entities = rawEntities;
      }
    }

    await this.broadcastService.handleBroadcastCommand(
      ctx,
      parsed.text || broadcastText,
      entities,
      parsed.excludeIdentifiers.length ? parsed.excludeIdentifiers : undefined,
    );
  }

  @Command('reply')
  async onReply(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const text = (ctx.message as any).text;
    const parts = text.split(' ');

    if (parts.length < 3) {
      await ctx.reply('Использование: /reply chat_id текст_ответа');
      return;
    }

    const targetChatId = parts[1];
    const replyText = parts.slice(2).join(' ');

    await this.supportService.handleReplyCommand(ctx, targetChatId, replyText);
  }

  @Command('webreply')
  async onWebReply(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const text = (ctx.message as any).text;
    const parts = text.split(' ');

    if (parts.length < 3) {
      await ctx.reply('Использование: /webreply request_id текст_ответа');
      return;
    }

    const requestId = parts[1];
    const replyText = parts.slice(2).join(' ');

    await this.supportService.handleWebReplyCommand(ctx, requestId, replyText);
  }

  @Command('replyPhoto')
  async onReplyPhoto(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const text = (ctx.message as any).text;
    const parts = text.split(' ');

    if (parts.length < 3) {
      await ctx.reply(
        'Использование: /replyPhoto chat_id текст_ответа\nЗатем отправьте фото в следующем сообщении',
      );
      return;
    }

    const targetChatId = parts[1];
    const replyText = parts.slice(2).join(' ');

    await this.supportService.handleReplyPhotoCommand(
      ctx,
      user,
      targetChatId,
      replyText,
    );
    await this.userRepository.save(user);
  }

  @Command('replySticker')
  async onReplySticker(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const text = (ctx.message as any).text;
    const parts = text.split(' ');

    if (parts.length < 2) {
      await ctx.reply(
        'Использование: /replySticker chat_id\nЗатем отправьте стикер в следующем сообщении',
      );
      return;
    }

    const targetChatId = parts[1];

    await this.supportService.handleReplyStickerCommand(
      ctx,
      user,
      targetChatId,
    );
    await this.userRepository.save(user);
  }

  @Command('replyVoice')
  async onReplyVoice(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const text = (ctx.message as any).text;
    const parts = text.split(' ');

    if (parts.length < 2) {
      await ctx.reply(
        'Использование: /replyVoice chat_id [текст_подписи]\nЗатем отправьте голосовое сообщение в следующем сообщении',
      );
      return;
    }

    const targetChatId = parts[1];
    const replyText = parts.slice(2).join(' ');

    await this.supportService.handleReplyVoiceCommand(
      ctx,
      user,
      targetChatId,
      replyText,
    );
    await this.userRepository.save(user);
  }

  @Command('replyVideoNote')
  async onReplyVideoNote(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const text = (ctx.message as any).text;
    const parts = text.split(' ');

    if (parts.length < 2) {
      await ctx.reply(
        'Использование: /replyVideoNote chat_id\nЗатем отправьте видео-кружок в следующем сообщении',
      );
      return;
    }

    const targetChatId = parts[1];

    await this.supportService.handleReplyVideoNoteCommand(
      ctx,
      user,
      targetChatId,
    );
    await this.userRepository.save(user);
  }

  @Command('year_end_broadcast')
  async onYearEndBroadcast(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    await ctx.reply(
      '🚀 Запуск новогодней рассылки... Это может занять некоторое время.',
    );
    await this.yearEndBroadcastService.handleYearEndBroadcast(ctx);
  }

  @Command('analytics')
  async onAnalytics(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📅 7 дней', 'analytics_period:7'),
        Markup.button.callback('📅 30 дней', 'analytics_period:30'),
      ],
      [
        Markup.button.callback('📆 Текущий месяц', 'analytics_month:0'),
        Markup.button.callback('📆 Прошлый месяц', 'analytics_month:-1'),
      ],
      [Markup.button.callback('👥 Общая статистика', 'analytics_total')],
    ]);

    const message = '📊 Аналитика бота\n\nВыберите период для просмотра:';

    const isCallback = !!ctx.callbackQuery;
    if (isCallback) {
      try {
        await ctx.editMessageText(message, keyboard);
      } catch {
        await ctx.reply(message, keyboard);
      }
    } else {
      await ctx.reply(message, keyboard);
    }
  }

  @Action(/^analytics_period:(\d+)$/)
  async onAnalyticsPeriod(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.answerCbQuery('❌ Доступно только администраторам');
      return;
    }

    await ctx.answerCbQuery('⏳ Загрузка...');
    // @ts-ignore
    const days = parseInt(ctx.match[1], 10);

    const eventNamesRu = this.getEventNamesRu();

    try {
      const [summary, totalUsers] = await Promise.all([
        this.analyticsService.getLastDaysSummary(days),
        this.analyticsService.getTotalUsers(),
      ]);

      const lines: string[] = [
        `📊 Аналитика за последние ${days} дней`,
        '',
        `👥 Всего пользователей: ${totalUsers}`,
        '',
        `📈 За период:`,
        `• Событий: ${summary.totalEvents}`,
        `• Активных пользователей: ${summary.uniqueUsers}`,
        '',
        '🔥 Топ действий:',
      ];

      summary.eventsByType.slice(0, 10).forEach((e, i) => {
        const eventName = eventNamesRu[e.eventType] || e.eventType;
        lines.push(`${i + 1}. ${eventName}: ${e.count}`);
      });

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('« Назад', 'back_to_analytics_menu')],
      ]);

      await ctx.editMessageText(lines.join('\n'), keyboard);
    } catch (err) {
      this.logger.error('Analytics period failed', err);
      await ctx.editMessageText('❌ Не удалось сформировать отчёт.');
    }
  }

  @Action(/^analytics_month:(-?\d+)$/)
  async onAnalyticsMonth(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.answerCbQuery('❌ Доступно только администраторам');
      return;
    }

    await ctx.answerCbQuery('⏳ Загрузка...');
    // @ts-ignore
    const offset = parseInt(ctx.match[1], 10);

    const eventNamesRu = this.getEventNamesRu();

    try {
      const now = new Date();
      const targetDate = new Date(
        now.getFullYear(),
        now.getMonth() + offset,
        1,
      );

      const [reportMonth, totalUsers, engagement] = await Promise.all([
        this.analyticsService.getMonthlyReport(targetDate),
        this.analyticsService.getTotalUsers(),
        this.analyticsService.getUserEngagement(),
      ]);

      const lines: string[] = [
        `📊 Аналитика за ${reportMonth.month}`,
        '',
        `👥 Всего пользователей: ${totalUsers}`,
        `📈 С подпиской: ${engagement.engagedUsers} (${engagement.engagementRate}%)`,
        '',
        `🗓️ За месяц:`,
        `• MAU: ${reportMonth.mau}`,
        `• Событий: ${reportMonth.totalEvents}`,
        `• Новых пользователей: ${reportMonth.newUsers}`,
        '',
        '🔥 Топ действий:',
      ];

      reportMonth.topEvents.slice(0, 10).forEach((e, i) => {
        const eventName = eventNamesRu[e.eventType] || e.eventType;
        lines.push(`${i + 1}. ${eventName}: ${e.count}`);
      });

      const navButtons = [];
      navButtons.push(
        Markup.button.callback(
          '👈 Пред. месяц',
          `analytics_month:${offset - 1}`,
        ),
      );
      if (offset < 0) {
        navButtons.push(
          Markup.button.callback(
            'След. месяц 👉',
            `analytics_month:${offset + 1}`,
          ),
        );
      }

      const keyboard = Markup.inlineKeyboard([
        navButtons,
        [Markup.button.callback('« Назад', 'back_to_analytics_menu')],
      ]);

      await ctx.editMessageText(lines.join('\n'), keyboard);
    } catch (err) {
      this.logger.error('Analytics month failed', err);
      await ctx.editMessageText('❌ Не удалось сформировать отчёт.');
    }
  }

  @Action('analytics_total')
  async onAnalyticsTotal(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.answerCbQuery('❌ Доступно только администраторам');
      return;
    }

    await ctx.answerCbQuery('⏳ Загрузка...');

    try {
      const [totalUsers, engagement] = await Promise.all([
        this.analyticsService.getTotalUsers(),
        this.analyticsService.getUserEngagement(),
      ]);

      const lines: string[] = [
        '📊 Общая статистика',
        '',
        `👥 Всего уникальных пользователей: ${totalUsers}`,
        `📈 С подпиской: ${engagement.engagedUsers} (${engagement.engagementRate}%)`,
        '',
        'ℹ️ Для детальной статистики выберите период.',
      ];

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('« Назад', 'back_to_analytics_menu')],
      ]);

      await ctx.editMessageText(lines.join('\n'), keyboard);
    } catch (err) {
      this.logger.error('Analytics total failed', err);
      await ctx.editMessageText('❌ Не удалось сформировать отчёт.');
    }
  }

  @Action('back_to_analytics_menu')
  async onBackToAnalyticsMenu(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.onAnalytics(ctx);
  }

  private getEventNamesRu(): Record<string, string> {
    return {
      'schedule_view:week': 'расписание | неделя',
      'schedule_view:quick_view': 'fast check расписания',
      'schedule_view:today': 'расписание | сегодня',
      'schedule_view:tomorrow': 'расписание | завтра',
      'schedule_view:exams': 'просмотр экзаменов',
      'schedule_view:day': 'просмотр расписания на день',
      'schedule_view:teacher_day': 'расписание преподавателя | день',
      'schedule_view:teacher_week': 'расписание преподавателя | неделя',
      'schedule_view:audience_day': 'расписание аудитории | день',
      'schedule_view:audience_week': 'расписание аудитории | неделя',
      'subscription:create': 'создание подписки',
      'subscription:delete': 'удаление подписки',
      'subscription:list': 'просмотр подписок',
      'support:message': 'сообщение в поддержку',
      'poll:answer': 'ответ на опрос',
      'user:start': 'старт бота',
      'user:help': 'справка',
      'referral:create': 'переход по реферальной ссылке',
      'notification:grade': 'уведомление об оценках',
      'notification:exam_new': 'уведомление о новом экзамене',
      'notification:exam_changed': 'уведомление об изменении экзамена',
      'notification:lesson': 'уведомление о занятии',
    };
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    // @ts-ignore
    const text = ctx.message.text;
    const user = await this.userHelperService.getUser(ctx);

    if (user?.state === 'WAITING_AI_KEYS' && user.isAdmin) {
      const trimmed = text.trim();
      if (trimmed.toLowerCase() === '/cancel') {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        await ctx.reply('✅ Добавление ключей отменено.');
        return;
      }
      const result = await this.groqService.addKeys(trimmed);
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      let msg = `✅ Ключи обработаны:\n• Добавлено: <b>${result.added}</b>\n• Уже были (пропущено): <b>${result.skipped}</b>`;
      if (result.errors.length) {
        msg += `\n• Ошибки: ${result.errors.slice(0, 5).join('; ')}`;
        if (result.errors.length > 5)
          msg += ` … и ещё ${result.errors.length - 5}`;
      }
      await ctx.reply(msg, { parse_mode: 'HTML' } as any);
      return;
    }

    if (user?.state === 'BROADCAST' && user.isAdmin) {
      const msg = ctx.message as {
        text?: string;
        entities?: import('telegraf/types').MessageEntity[];
      };
      const raw = text.trim();
      const parsed = parseBroadcastExclude(raw);
      if (parsed.excludeIdentifiers.length && !parsed.text.trim()) {
        await ctx.reply(
          'Укажите текст рассылки после строки с исключениями (вторая строка и далее).',
        );
        return;
      }
      let entities = msg.entities;
      if (parsed.entityOffsetShift > 0 && entities?.length) {
        entities = entities
          .filter(
            (e) =>
              e.offset >= parsed.entityOffsetShift &&
              e.offset + e.length <=
                parsed.entityOffsetShift + parsed.text.length,
          )
          .map((e) => ({
            ...e,
            offset: e.offset - parsed.entityOffsetShift,
          }));
      }
      await this.broadcastService.handleBroadcastCommand(
        ctx,
        parsed.text || raw,
        entities,
        parsed.excludeIdentifiers.length
          ? parsed.excludeIdentifiers
          : undefined,
      );
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      return;
    }

    const allowedCommands = [
      '📅 Сегодня',
      '/today',
      'сегодня',
      '📅 Завтра',
      '/tomorrow',
      'завтра',
      '📅 Неделя',
      '/week',
      'неделя',
      '📝 Экзамены',
      '/exams',
      'экзамены',
      '⚙️ Настройки',
      '/settings',
      'настройки',
    ];
    const isAllowedCommand = allowedCommands.includes(text.trim());
    if (ctx.chat?.type !== 'private' && !user?.state && !isAllowedCommand) {
      return;
    }

    const handled = await this.textHandlerService.handleText(ctx, user, text);

    if (!handled) {
      if (ctx.chat?.type !== 'private') return;

      if (user && !user.isAdmin) {
        const userInfo = await this.getUserInfoForAdmin(user);
        const helpMessage = this.textHandlerService.getHelpMessage();

        const info = `❓ <b>Нераспознанное сообщение</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Запрос:</b>\n${escapeHtml(text)}\n\n<b>✅ Ответ пользователю:</b>\n${escapeHtml(helpMessage)}`;
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);

        const admins = await this.userRepository.find({
          where: { isAdmin: true },
        });
        for (const admin of admins) {
          try {
            await ctx.telegram.sendMessage(admin.chatId, info, {
              parse_mode: 'HTML',
              ...kb,
            } as any);
          } catch (e) {
            this.logger.error(`Failed to send to admin ${admin.chatId}`, e);
          }
        }
      }
      user.stateData = { backTarget: 'help' };
      await this.userRepository.save(user);
      const helpButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🔔 Подписаться на группу',
            'open_subscribe:help',
          ),
        ],
        [
          Markup.button.callback(
            '💬 Написать в поддержку',
            'open_support:help',
          ),
        ],
      ]);
      await this.replyWithFooter(
        ctx,
        this.textHandlerService.getHelpMessage(),
        {
          ...getMainKeyboard(),
          ...helpButtons,
        },
      );
    }
  }

  @On('photo')
  async onPhoto(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const message = ctx.message as any;
    const photo = message.photo[message.photo.length - 1];
    const fileId = photo.file_id;
    const caption = message.caption || '';

    if (user && !user.isAdmin && ctx.chat?.type === 'private') {
      try {
        const admins = await this.userRepository.find({
          where: { isAdmin: true },
        });

        const userInfo = await this.getUserInfoForAdmin(user);
        const replyMessage =
          'Фотография получена, но не указана тема. Используйте /support или /suggestion';

        const photoInfo = `📷 <b>Фотография (вне контекста)</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Подпись:</b>\n${caption || '[без текста]'}\n<b>🆔 File ID:</b> <code>${fileId}</code>\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;

        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        for (const admin of admins) {
          try {
            await ctx.telegram.sendMessage(admin.chatId, photoInfo, {
              parse_mode: 'HTML',
              ...kb,
            } as any);
          } catch (e) {
            this.logger.debug(
              `Failed forwarding photo to admin ${admin.chatId}`,
            );
          }
        }
      } catch (e) {
        this.logger.error('Error while forwarding photo to admins', e);
      }
    }

    if (user.state === 'ADMIN_REPLY' && user.isAdmin) {
      await this.supportService.handleReplyPhoto(ctx, user, fileId, caption);
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'BROADCAST' && user.isAdmin) {
      const captionEntities = (
        message as {
          caption_entities?: import('telegraf/types').MessageEntity[];
        }
      ).caption_entities;
      const parsed = parseBroadcastExclude(caption || '');
      let entities = captionEntities;
      if (parsed.entityOffsetShift > 0 && entities?.length) {
        entities = entities
          .filter(
            (e) =>
              e.offset >= parsed.entityOffsetShift &&
              e.offset + e.length <=
                parsed.entityOffsetShift + parsed.text.length,
          )
          .map((e) => ({
            ...e,
            offset: e.offset - parsed.entityOffsetShift,
          }));
      }
      await this.broadcastService.handleBroadcastPhoto(
        ctx,
        fileId,
        parsed.text || caption,
        entities,
        parsed.excludeIdentifiers.length
          ? parsed.excludeIdentifiers
          : undefined,
      );
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'POLL_IMAGE' && user.isAdmin) {
      await this.pollService.handlePollPhoto(ctx, user, fileId);
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      await this.supportService.handleSupportPhoto(ctx, user, fileId, caption);
      await this.userRepository.save(user);
      return;
    }

    if (user.isAdmin && message.caption?.startsWith('/broadcast')) {
      const fullCaption = message.caption;
      const broadcastCaption = fullCaption.replace('/broadcast', '').trim();
      const parsed = parseBroadcastExclude(broadcastCaption);
      const startIdx = fullCaption.indexOf(broadcastCaption);
      let captionEntities: import('telegraf/types').MessageEntity[] | undefined;
      if (startIdx >= 0 && (message as any).caption_entities?.length) {
        const raw = (message as any).caption_entities
          .map((e: import('telegraf/types').MessageEntity) => ({
            ...e,
            offset: e.offset - startIdx,
          }))
          .filter(
            (e: import('telegraf/types').MessageEntity) =>
              e.offset >= 0 && e.offset + e.length <= broadcastCaption.length,
          );
        if (parsed.entityOffsetShift > 0) {
          captionEntities = raw
            .filter(
              (e: import('telegraf/types').MessageEntity) =>
                e.offset >= parsed.entityOffsetShift &&
                e.offset + e.length <=
                  parsed.entityOffsetShift + parsed.text.length,
            )
            .map((e: import('telegraf/types').MessageEntity) => ({
              ...e,
              offset: e.offset - parsed.entityOffsetShift,
            }));
        } else {
          captionEntities = raw;
        }
      }
      await this.broadcastService.handleBroadcastPhoto(
        ctx,
        fileId,
        parsed.text || broadcastCaption,
        captionEntities,
        parsed.excludeIdentifiers.length
          ? parsed.excludeIdentifiers
          : undefined,
      );
      return;
    }

    if (user.state === 'ADMIN_REPLY_PHOTO' && user.isAdmin) {
      await this.supportService.handleReplyPhoto(ctx, user, fileId);
      await this.userRepository.save(user);
      return;
    }

    if (!user.state && ctx.chat?.type === 'private') {
      await this.textHandlerService.handlePhoto(ctx, user);
      return;
    }

    if (!user.state && !user.isAdmin) {
      await ctx.reply(
        'Фотография получена, но не указана тема. Используйте /support или /suggestion',
      );
    }
  }

  @On('document')
  async onDocument(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user || ctx.chat?.type !== 'private') return;
    if (user.state) return;

    const message = ctx.message as any;
    const document = message.document;

    if (!document?.file_id) return;

    const originalFileName = this.sanitizeDocxFileName(document.file_name);
    if (!originalFileName.toLowerCase().endsWith('.docx')) {
      await ctx.reply(
        '⚠️ Поддерживаются только документы .docx\n\n' +
          'Отправьте файл в формате DOCX и я отформатирую его по ГОСТ.',
      );
      return;
    }

    const fileSize = Number(document.file_size || 0);
    const maxTelegramDocSize = 10 * 1024 * 1024;
    if (fileSize > maxTelegramDocSize) {
      await ctx.reply('⚠️ Файл слишком большой. Максимальный размер — 10 МБ.');
      return;
    }

    const limit = await this.formatLimitClient.checkLimit(user.id, true);
    if (!limit.can) {
      await ctx.reply(
        `⚠️ Лимит форматирования исчерпан.\n` +
          `Осталось: ${limit.remaining ?? 0}\n\n` +
          `Купить дополнительные форматирования: /format_buy`,
      );
      return;
    }

    let statusMessage;
    try {
      const downloadEmoji = TelegramCustomEmojis.format.download.char;
      const downloadText = ' Скачиваю файл из Telegram...';
      const downloadFullText = downloadEmoji + downloadText;
      try {
        statusMessage = await ctx.reply(downloadFullText, {
          entities: [
            {
              type: 'custom_emoji',
              offset: 0,
              length: downloadEmoji.length,
              custom_emoji_id: TelegramCustomEmojis.format.download.id,
            },
          ],
        } as any);
      } catch (e) {
        this.logger.warn(
          'Failed to send download status with custom emoji, falling back to plain text',
          e as any,
        );
        statusMessage = await ctx.reply('⬇️ Скачиваю файл из Telegram...');
      }

      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await axios.get(fileLink.toString(), {
        responseType: 'arraybuffer',
      });
      const sourceBuffer = Buffer.from(response.data);

      const emojiChar = TelegramCustomEmojis.format.processing.char;
      const processingText = ' Обрабатываю документ, почти готово...';
      const processingFullText = emojiChar + processingText;

      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          processingFullText,
          {
            entities: [
              {
                type: 'custom_emoji',
                offset: 0,
                length: emojiChar.length,
                custom_emoji_id: TelegramCustomEmojis.format.processing.id,
              },
            ],
          } as any,
        );
      } catch (e) {
        this.logger.warn(
          'Failed to edit status message with custom emoji, falling back to plain text',
          e as any,
        );
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          '⚙️ Обрабатываю документ, почти готово...',
        );
      }

      const result = await this.formatLimitClient.processDocument(
        user.id,
        originalFileName,
        sourceBuffer.toString('base64'),
        { isTelegram: true },
      );

      if (!result.success || !result.formattedBase64) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          `❌ Не удалось отформатировать документ: ${
            result.reason || 'ошибка сервиса'
          }`,
        );
        return;
      }

      const formattedBuffer = Buffer.from(result.formattedBase64, 'base64');
      const targetName = originalFileName.endsWith('.docx')
        ? `${originalFileName.slice(0, -5)}_gost.docx`
        : `${originalFileName}_gost.docx`;

      await ctx.replyWithDocument({
        source: formattedBuffer,
        filename: targetName,
      });

      const doneEmoji = TelegramCustomEmojis.format.done.char;
      const doneText = ` Готово. Осталось форматирований: ${result.remaining}`;
      const doneFullText = doneEmoji + doneText;

      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          doneFullText,
          {
            entities: [
              {
                type: 'custom_emoji',
                offset: 0,
                length: doneEmoji.length,
                custom_emoji_id: TelegramCustomEmojis.format.done.id,
              },
            ],
          } as any,
        );
      } catch (e) {
        this.logger.warn(
          'Failed to edit done status with custom emoji, falling back to plain text',
          e as any,
        );
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          `✅ Готово. Осталось форматирований: ${result.remaining}`,
        );
      }
    } catch (error) {
      this.logger.error('Document formatting failed', error);
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          undefined,
          '❌ Ошибка при обработке документа. Попробуйте позже или отправьте файл снова.',
        );
      } catch {
        await ctx.reply(
          '❌ Ошибка при обработке документа. Попробуйте позже или отправьте файл снова.',
        );
      }
    }
  }

  @On('sticker')
  async onSticker(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const message = ctx.message as any;
    const sticker = message.sticker;
    const fileId = sticker.file_id;

    if (
      (user.state === 'ADMIN_REPLY_STICKER' || user.state === 'ADMIN_REPLY') &&
      user.isAdmin
    ) {
      await this.supportService.handleReplySticker(ctx, user, fileId);
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'BROADCAST' && user.isAdmin) {
      await this.broadcastService.handleBroadcastSticker(ctx, fileId);
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      await this.supportService.handleSupportSticker(ctx, user, fileId);
      await this.userRepository.save(user);
      return;
    }

    if (user && !user.isAdmin && ctx.chat?.type === 'private') {
      try {
        const admins = await this.userRepository.find({
          where: { isAdmin: true },
        });
        const userInfo = await this.getUserInfoForAdmin(user);
        const replyMessage =
          'Стикер получен, но не указана тема. Используйте /support или /suggestion';
        const stickerInfo = `🎭 <b>Стикер (вне контекста)</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>🆔 File ID:</b> <code>${fileId}</code>\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        for (const admin of admins) {
          try {
            await ctx.telegram.sendSticker(admin.chatId, fileId);
            await ctx.telegram.sendMessage(admin.chatId, stickerInfo, {
              parse_mode: 'HTML',
              ...kb,
            } as any);
          } catch (e) {
            this.logger.debug(
              `Failed forwarding sticker to admin ${admin.chatId}`,
            );
          }
        }
      } catch (e) {
        this.logger.error('Error while forwarding sticker to admins', e);
      }
      await ctx.reply(
        'Стикер получен, но не указана тема. Используйте /support или /suggestion',
      );
    }
  }

  @On('video_note')
  async onVideoNote(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const message = ctx.message as any;
    const videoNote = message.video_note;
    const fileId = videoNote.file_id;

    if (
      (user.state === 'ADMIN_REPLY_VIDEO_NOTE' ||
        user.state === 'ADMIN_REPLY') &&
      user.isAdmin
    ) {
      await this.supportService.handleReplyVideoNote(ctx, user, fileId);
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'BROADCAST' && user.isAdmin) {
      await this.broadcastService.handleBroadcastVideoNote(ctx, fileId);
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      await this.supportService.handleSupportVideoNote(ctx, user, fileId);
      await this.userRepository.save(user);
      return;
    }

    if (user && !user.isAdmin && ctx.chat?.type === 'private') {
      try {
        const admins = await this.userRepository.find({
          where: { isAdmin: true },
        });
        const userInfo = await this.getUserInfoForAdmin(user);
        const replyMessage =
          'Видео-кружок получен, но не указана тема. Используйте /support или /suggestion';
        const videoNoteInfo = `🎬 <b>Видео-кружок (вне контекста)</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>🆔 File ID:</b> <code>${fileId}</code>\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        for (const admin of admins) {
          try {
            await ctx.telegram.sendVideoNote(admin.chatId, fileId);
            await ctx.telegram.sendMessage(admin.chatId, videoNoteInfo, {
              parse_mode: 'HTML',
              ...kb,
            } as any);
          } catch (e) {
            this.logger.debug(
              `Failed forwarding video note to admin ${admin.chatId}`,
            );
          }
        }
      } catch (e) {
        this.logger.error('Error while forwarding video note to admins', e);
      }
      await ctx.reply(
        'Видео-кружок получен, но не указана тема. Используйте /support или /suggestion',
      );
    }
  }

  @On('voice')
  async onVoice(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user) return;

    const message = ctx.message as any;
    const voice = message.voice;
    const fileId = voice.file_id;
    const caption = message.caption || '';

    if (
      (user.state === 'ADMIN_REPLY_VOICE' || user.state === 'ADMIN_REPLY') &&
      user.isAdmin
    ) {
      await this.supportService.handleReplyVoice(ctx, user, fileId, caption);
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'BROADCAST' && user.isAdmin) {
      const captionEntities = (
        message as {
          caption_entities?: import('telegraf/types').MessageEntity[];
        }
      ).caption_entities;
      const parsed = parseBroadcastExclude(caption || '');
      let entities = captionEntities;
      if (parsed.entityOffsetShift > 0 && entities?.length) {
        entities = entities
          .filter(
            (e) =>
              e.offset >= parsed.entityOffsetShift &&
              e.offset + e.length <=
                parsed.entityOffsetShift + parsed.text.length,
          )
          .map((e) => ({
            ...e,
            offset: e.offset - parsed.entityOffsetShift,
          }));
      }
      await this.broadcastService.handleBroadcastVoice(
        ctx,
        fileId,
        parsed.text || caption,
        entities,
        parsed.excludeIdentifiers.length
          ? parsed.excludeIdentifiers
          : undefined,
      );
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      await this.supportService.handleSupportVoice(ctx, user, fileId, caption);
      await this.userRepository.save(user);
      return;
    }

    if (user && !user.isAdmin && ctx.chat?.type === 'private') {
      try {
        const admins = await this.userRepository.find({
          where: { isAdmin: true },
        });
        const userInfo = await this.getUserInfoForAdmin(user);
        const replyMessage =
          'Голосовое получено, но не указана тема. Используйте /support или /suggestion';
        const voiceInfo = `🎤 <b>Голосовое сообщение (вне контекста)</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Подпись:</b>\n${caption || '[без текста]'}\n<b>🆔 File ID:</b> <code>${fileId}</code>\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        for (const admin of admins) {
          try {
            await ctx.telegram.sendVoice(admin.chatId, fileId, {
              caption: voiceInfo,
              parse_mode: 'HTML',
              ...kb,
            } as any);
          } catch (e) {
            this.logger.debug(
              `Failed forwarding voice to admin ${admin.chatId}`,
            );
          }
        }
      } catch (e) {
        this.logger.error('Error while forwarding voice to admins', e);
      }
      await ctx.reply(
        'Голосовое получено, но не указана тема. Используйте /support или /suggestion',
      );
      return;
    }

    if (!user.state && ctx.chat?.type === 'private') {
      await this.textHandlerService.handleVoice(ctx, user);
    }
  }

  @On('video')
  async onVideo(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    const message = ctx.message as any;
    const video = message.video;
    const fileId = video.file_id;
    const caption = message.caption || '';

    if (user.state === 'BROADCAST' && user.isAdmin) {
      const captionEntities = (
        message as {
          caption_entities?: import('telegraf/types').MessageEntity[];
        }
      ).caption_entities;
      const parsed = parseBroadcastExclude(caption || '');
      let entities = captionEntities;
      if (parsed.entityOffsetShift > 0 && entities?.length) {
        entities = entities
          .filter(
            (e) =>
              e.offset >= parsed.entityOffsetShift &&
              e.offset + e.length <=
                parsed.entityOffsetShift + parsed.text.length,
          )
          .map((e) => ({
            ...e,
            offset: e.offset - parsed.entityOffsetShift,
          }));
      }
      await this.broadcastService.handleBroadcastVideo(
        ctx,
        fileId,
        parsed.text || caption,
        entities,
        parsed.excludeIdentifiers.length
          ? parsed.excludeIdentifiers
          : undefined,
      );
      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      return;
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      await this.supportService.handleSupportVideo(ctx, user, fileId, caption);
      await this.userRepository.save(user);
      return;
    }

    if (user && !user.isAdmin && ctx.chat?.type === 'private' && !user.state) {
      try {
        const admins = await this.userRepository.find({
          where: { isAdmin: true },
        });

        const userInfo = await this.getUserInfoForAdmin(user);
        const replyMessage =
          'Видео получено, но не указана тема. Используйте /support или /suggestion';

        const videoInfo = `🎥 <b>Видео (вне контекста)</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Подпись:</b>\n${caption || '[без текста]'}\n<b>🆔 File ID:</b> <code>${fileId}</code>\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;

        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        for (const admin of admins) {
          try {
            await ctx.telegram.sendMessage(admin.chatId, videoInfo, {
              parse_mode: 'HTML',
              ...kb,
            } as any);
          } catch (e) {
            this.logger.debug(
              `Failed forwarding video to admin ${admin.chatId}`,
            );
          }
        }
      } catch (e) {
        this.logger.error('Error while forwarding video to admins', e);
      }
    }

    if (user.isAdmin && message.caption?.startsWith('/broadcast')) {
      const fullCaption = message.caption;
      const broadcastCaption = fullCaption.replace('/broadcast', '').trim();
      const parsed = parseBroadcastExclude(broadcastCaption);
      const startIdx = fullCaption.indexOf(broadcastCaption);
      let captionEntities: import('telegraf/types').MessageEntity[] | undefined;
      if (startIdx >= 0 && (message as any).caption_entities?.length) {
        const raw = (message as any).caption_entities
          .map((e: import('telegraf/types').MessageEntity) => ({
            ...e,
            offset: e.offset - startIdx,
          }))
          .filter(
            (e: import('telegraf/types').MessageEntity) =>
              e.offset >= 0 && e.offset + e.length <= broadcastCaption.length,
          );
        if (parsed.entityOffsetShift > 0) {
          captionEntities = raw
            .filter(
              (e: import('telegraf/types').MessageEntity) =>
                e.offset >= parsed.entityOffsetShift &&
                e.offset + e.length <=
                  parsed.entityOffsetShift + parsed.text.length,
            )
            .map((e: import('telegraf/types').MessageEntity) => ({
              ...e,
              offset: e.offset - parsed.entityOffsetShift,
            }));
        } else {
          captionEntities = raw;
        }
      }
      await this.broadcastService.handleBroadcastVideo(
        ctx,
        fileId,
        parsed.text || broadcastCaption,
        captionEntities,
        parsed.excludeIdentifiers.length
          ? parsed.excludeIdentifiers
          : undefined,
      );
      return;
    }

    if (!user.state && !user.isAdmin) {
      await ctx.reply(
        'Видео получено, но не указана тема. Используйте /support или /suggestion',
      );
    }
  }

  @On('pre_checkout_query')
  async onPreCheckoutQuery(@Ctx() ctx: Context) {
    await ctx.answerPreCheckoutQuery(true);
  }

  @On('successful_payment')
  async onSuccessfulPayment(@Ctx() ctx: Context) {
    const message = ctx.message as any;
    const payment = message.successful_payment;
    const payload = payment.invoice_payload || '';
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const user = await this.userRepository.findOne({
      where: { chatId: String(chatId) },
    });

    if (payload === 'ai_plus_1m' && user) {
      const result = await this.aiSubscriptionService.activatePlus(
        user,
        payment.provider_payment_charge_id,
      );
      const { subscription, wasExtended, previousExpiresAt } = result;

      const usageAtPurchase = await this.aiLimitService.getUsageSnapshot(user);
      const paymentRow = this.aiPaymentRepository.create({
        user,
        payload,
        amountKops: payment.total_amount,
        currency: payment.currency,
        telegramPaymentChargeId: payment.telegram_payment_charge_id || null,
        providerPaymentChargeId: payment.provider_payment_charge_id || null,
        subscriptionId: subscription.id,
        usageMonthlyCountAtPurchase: usageAtPurchase.monthlyCount,
        usageWeeklyCountAtPurchase: usageAtPurchase.weeklyCount,
        status: 'succeeded',
      });
      await this.aiPaymentRepository.save(paymentRow);

      const line1 = wasExtended
        ? `✅ Подписка <b>AI Plus</b> продлена.`
        : `✅ Подписка <b>AI Plus</b> активирована.`;
      const datesLine =
        wasExtended && previousExpiresAt
          ? `Было до: ${previousExpiresAt.toLocaleDateString('ru-RU')}\nСтало до: ${subscription.expiresAt.toLocaleDateString('ru-RU')}`
          : `Действует до: ${subscription.expiresAt.toLocaleDateString('ru-RU')}`;
      await ctx.reply(
        `${line1}\n${datesLine}\n\n` +
          `Лимит: <b>200 запросов/месяц</b> (не суммируется при повторной покупке).\n` +
          `Команда /profile покажет, сколько осталось в этом месяце.`,
        { parse_mode: 'HTML' },
      );
      this.logger.log(
        `AI Plus activated for user ${user.chatId}, expires ${subscription.expiresAt.toISOString()}, charge_id ${payment.provider_payment_charge_id}`,
      );
      return;
    }

    if (payload === 'format_10' && user) {
      try {
        const result = await this.formatLimitClient.addPaidFormats(
          user.id,
          10,
          { isTelegram: true },
        );

        await ctx.reply(
          `✅ Оплата подтверждена.\n` +
            `Начислено форматирований: ${result.formatsAdded}\n` +
            `Текущий остаток: ${result.remaining}`,
        );
      } catch (error) {
        this.logger.error(
          'Failed to add paid formats after Telegram payment',
          error,
        );
        await ctx.reply(
          '❌ Платеж получен, но не удалось начислить форматирования. Напишите в поддержку.',
        );
      }
      return;
    }

    if (payload === 'support_stars') {
      await ctx.reply(
        'Спасибо за вашу поддержку! 🌟\nВаш вклад поможет сделать бота еще лучше.',
      );
    }

    this.logger.log(
      `Payment received: ${payment.total_amount / 100} ${payment.currency} from ${chatId}, payload=${payload}`,
    );
  }

  @Command('sendpoll')
  async onSendPoll(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    const text = (ctx.message as any).text;
    const pollId = parseInt(text.replace('/sendpoll', '').trim());

    if (isNaN(pollId)) {
      await ctx.reply('Использование: /sendpoll poll_id');
      return;
    }

    await this.pollService.handleSendPollCommand(ctx, pollId);
  }

  @Action(/^poll:(\d+):(.+)$/)
  async onPollAnswer(@Ctx() ctx: Context) {
    // @ts-ignore
    const pollId = parseInt(ctx.match[1]);
    // @ts-ignore
    const answer = ctx.match[2];
    await this.pollService.handlePollAnswer(ctx, pollId, answer);
  }
}
