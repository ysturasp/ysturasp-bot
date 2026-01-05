import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { ConfigService } from '@nestjs/config';
import { getMainKeyboard } from './helpers/keyboard.helper';
import { SupportService } from './services/support.service';
import { PollService } from './services/poll.service';
import { BroadcastService } from './services/broadcast.service';
import { SubscriptionService } from './services/subscription.service';
import { ScheduleCommandService } from './services/schedule-command.service';
import { UserHelperService } from './services/user-helper.service';
import { TextHandlerService } from './services/text-handler.service';
import { YearEndBroadcastService } from './services/year-end-broadcast.service';
import { ReferralService } from './services/referral.service';

@Update()
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
  ) {}
  @Command('exams')
  async onExams(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.scheduleCommandService.handleExams(ctx, user.id);
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
        await ctx.reply(
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

              await ctx.reply(referralMessage, {
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
            await ctx.reply(
              'ℹ️ Вы уже были приглашены по реферальной ссылке ранее.',
            );
          }
        } else if (referrerUser && referrerUser.id === dbUser.id) {
          referralProcessed = true;
          await ctx.reply(
            '⚠️ Вы не можете пригласить самого себя по реферальной ссылке.',
          );
        } else if (!referrerUser) {
          referralProcessed = true;
          await ctx.reply(
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

    dbUser.stateData = { backTarget: 'main' };
    await this.userRepository.save(dbUser);

    let message = `👋 Привет, ${user.first_name}! это ysturasp бот`;

    const mainButtons = [
      [Markup.button.callback('📩 Отправить проблему', 'open_support:main')],
      [Markup.button.callback('💡 Предложить идею', 'open_suggestion:main')],
      [
        Markup.button.callback(
          '⭐ Поддержать звездами',
          'open_support_stars:main',
        ),
      ],
      [
        Markup.button.callback('🔔 Подписаться', 'open_subscribe:main'),
        Markup.button.callback('❌ Отписаться', 'open_unsubscribe'),
      ],
      [
        Markup.button.url(
          'Открыть приложение',
          'https://t.me/ysturasp_bot/ysturasp_webapp',
        ),
      ],
    ];

    if (dbUser.isAdmin) {
      mainButtons.push([
        Markup.button.callback('🛠️ Создать опрос', 'open_createpoll'),
        Markup.button.callback('📢 Рассылка', 'open_broadcast'),
      ]);
    }

    message += `\n\nТакже вы можете просто ввести название группы (например, ЦИС-33), чтобы посмотреть расписание или подписаться на уведомления.`;

    await ctx.reply(message, {
      ...getMainKeyboard(),
      ...Markup.inlineKeyboard(mainButtons),
    });
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

  @Action(/^view_day:(.+):(\d+)$/)
  async onViewDay(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    // @ts-ignore
    const dayOffset = parseInt(ctx.match[2]);
    await this.scheduleCommandService.handleViewDay(ctx, groupName, dayOffset);
  }

  @Action(/^view_week:(.+)$/)
  async onViewWeek(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    await this.scheduleCommandService.handleViewWeek(ctx, groupName);
  }

  @Action(/^back_to_group:(.+)$/)
  async onBackToGroup(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    const user = await this.userHelperService.getUser(ctx);
    await this.scheduleCommandService.handleBackToGroup(ctx, user, groupName);
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
      await ctx.reply('❌ Эта функция доступна только администраторам.');
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
          'Отправьте текст для рассылки или пришлите фото с подписью. После отправки рассылка будет выполнена.',
          kb2 as any,
        );
        return;
      } catch (e) {}
    }
    await ctx.reply(
      'Отправьте текст для рассылки или пришлите фото с подписью. После отправки рассылка будет выполнена.',
      kb2 as any,
    );
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

  @Action('open_set_default')
  async onOpenSetDefault(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await ctx.answerCbQuery();
    await this.subscriptionService.handleOpenSetDefault(ctx, user);
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
    } else if (backTarget === 'main') {
      const fromUser = ctx.from;
      const dbUser = user;

      let message = `👋 Привет, ${fromUser?.first_name || ''}! это ysturasp бот`;

      const mainButtons = [
        [Markup.button.callback('📩 Отправить проблему', 'open_support:main')],
        [Markup.button.callback('💡 Предложить идею', 'open_suggestion:main')],
        [
          Markup.button.callback(
            '⭐ Поддержать звездами',
            'open_support_stars:main',
          ),
        ],
        [
          Markup.button.callback('🔔 Подписаться', 'open_subscribe:main'),
          Markup.button.callback('❌ Отписаться', 'open_unsubscribe'),
        ],
        [
          Markup.button.url(
            'Открыть приложение',
            'https://t.me/ysturasp_bot/ysturasp_webapp',
          ),
        ],
      ];

      if (dbUser.isAdmin) {
        mainButtons.push([
          Markup.button.callback('🛠️ Создать опрос', 'open_createpoll'),
          Markup.button.callback('📢 Рассылка', 'open_broadcast'),
        ]);
      }

      message += `\n\nТакже вы можете просто ввести название группы (например, ЦИС-33), чтобы посмотреть расписание или подписаться на уведомления.`;

      try {
        await ctx.editMessageText(
          message,
          Markup.inlineKeyboard(mainButtons) as any,
        );
      } catch (e) {
        await ctx.reply(message, {
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

  @Command('subscriptions')
  async onSubscriptions(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.subscriptionService.handleSubscriptions(ctx, user);
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

    const text = (ctx.message as any).text;
    const broadcastText = text.replace('/broadcast', '').trim();

    if (!broadcastText) {
      await ctx.reply(
        'Использование:\n/broadcast текст_сообщения\n\nИли отправьте фото с подписью:\n/broadcast текст_сообщения',
      );
      return;
    }

    await this.broadcastService.handleBroadcastCommand(ctx, broadcastText);
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

  @On('text')
  async onText(@Ctx() ctx: Context) {
    // @ts-ignore
    const text = ctx.message.text;
    const user = await this.userHelperService.getUser(ctx);

    if (user && !user.isAdmin && ctx.chat?.type === 'private') {
      try {
        const admins = await this.userRepository.find({
          where: { isAdmin: true },
        });
        const fromName =
          ctx.from?.first_name || ctx.from?.username || 'Unknown';
        const username = ctx.from?.username
          ? `@${ctx.from.username}`
          : 'нет username';
        const info = `Сообщение от ${fromName} (${username}; chatId: ${user.chatId}):\n${text}`;
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        for (const admin of admins) {
          try {
            await ctx.telegram.sendMessage(admin.chatId, info, kb as any);
          } catch (e) {
            this.logger.debug(
              `Failed forwarding message to admin ${admin.chatId}`,
            );
          }
        }
      } catch (e) {
        this.logger.error('Error while forwarding message to admins', e);
      }
    }

    if (user?.state === 'BROADCAST' && user.isAdmin) {
      await this.broadcastService.handleBroadcastCommand(ctx, text.trim());
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
      if (user && user.isAdmin) {
        const fromName =
          ctx.from?.first_name || ctx.from?.username || 'Unknown';
        const username = ctx.from?.username
          ? `@${ctx.from.username}`
          : 'нет username';
        const info = `Сообщение (нераспознано) от ${fromName} (${username}; chatId: ${user.chatId}):\n${text}`;
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        await ctx.telegram.sendMessage(user.chatId, info, kb as any);
      }
      await ctx.reply(
        this.textHandlerService.getHelpMessage(),
        getMainKeyboard(),
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
        const fromName =
          ctx.from?.first_name || ctx.from?.username || 'Unknown';
        const username = ctx.from?.username
          ? `@${ctx.from.username}`
          : 'нет username';
        const info = `Фотография от ${fromName} (${username}; chatId: ${user.chatId})\nfile_id: ${fileId}\ncaption: ${caption}`;
        const kb = Markup.inlineKeyboard([
          [Markup.button.callback('Ответить', `admin_reply:${user.chatId}`)],
        ]);
        for (const admin of admins) {
          try {
            await ctx.telegram.sendMessage(admin.chatId, info, kb as any);
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

    if (user.state === 'BROADCAST' && user.isAdmin) {
      await this.broadcastService.handleBroadcastPhoto(ctx, fileId, caption);
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
      const broadcastCaption = message.caption.replace('/broadcast', '').trim();
      await this.broadcastService.handleBroadcastPhoto(
        ctx,
        fileId,
        broadcastCaption,
      );
      return;
    }

    if (user.state === 'ADMIN_REPLY_PHOTO' && user.isAdmin) {
      await this.supportService.handleReplyPhoto(ctx, user, fileId);
      await this.userRepository.save(user);
      return;
    }

    if (!user.state && !user.isAdmin) {
      await ctx.reply(
        'Фотография получена, но не указана тема. Используйте /support или /suggestion',
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

    await ctx.reply(
      'Спасибо за вашу поддержку! 🌟\nВаш вклад поможет сделать бота еще лучше.',
    );

    this.logger.log(
      `Payment received: ${payment.total_amount / 100} ${payment.currency} from ${ctx.chat.id}`,
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
