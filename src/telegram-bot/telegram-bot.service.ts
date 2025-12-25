import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { Exam } from '../database/entities/exam.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { formatSchedule } from '../helpers/schedule-formatter';
import { ConfigService } from '@nestjs/config';
import { getMainKeyboard } from './helpers/keyboard.helper';
import { SupportService } from './services/support.service';
import { PollService } from './services/poll.service';
import { BroadcastService } from './services/broadcast.service';
import { NotificationTestService } from './services/notification-test.service';
import { SubscriptionService } from './services/subscription.service';
import { ScheduleCommandService } from './services/schedule-command.service';
import { UserHelperService } from './services/user-helper.service';
import { TextHandlerService } from './services/text-handler.service';

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
    private readonly notificationTestService: NotificationTestService,
    private readonly subscriptionService: SubscriptionService,
    private readonly scheduleCommandService: ScheduleCommandService,
    private readonly userHelperService: UserHelperService,
    private readonly textHandlerService: TextHandlerService,
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

    let message = `👋 Привет, ${user.first_name}! Я бот для расписания занятий.

Вот что я умею:
/support — Отправить проблему
/suggestion — Оставить предложение
/support_stars — Поддержать проект звездами Telegram
/subscribe — Подписаться на уведомления
/unsubscribe — Отписаться от уведомлений
/subscriptions — Посмотреть текущие подписки
/exams — Посмотреть экзамены
/test_notify — Протестировать уведомления

Также вы можете просто ввести название группы (например, ЦИС-33), чтобы посмотреть расписание или подписаться на уведомления.

📅 Используйте кнопки ниже для быстрого доступа к расписанию!`;

    if (dbUser.isAdmin) {
      message += `\n\nКоманды администратора:\n/createpoll — Создать опрос\n/broadcast — Отправить сообщение всем\n/reply — Ответить на сообщение\n/replyPhoto — Ответить на сообщение с фото`;
    }

    await ctx.reply(message, {
      ...getMainKeyboard(),
      ...Markup.inlineKeyboard([
        [
          Markup.button.url(
            'Открыть приложение',
            'https://t.me/ysturasp_bot/ysturasp_webapp',
          ),
        ],
      ]),
    });
  }

  @Command('subscribe')
  async onSubscribe(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
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

  @Action('back_to_subscribe')
  async onBackToSubscribe(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.subscriptionService.handleBackToSubscribe(ctx, user);
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

  @Command('test_notify')
  async onTestNotify(@Ctx() ctx: Context) {
    const user = await this.userHelperService.getUser(ctx);
    await this.notificationTestService.handleTestNotify(ctx, user.id);
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

  @On('text')
  async onText(@Ctx() ctx: Context) {
    // @ts-ignore
    const text = ctx.message.text;
    const user = await this.userHelperService.getUser(ctx);

    const handled = await this.textHandlerService.handleText(ctx, user, text);
    if (!handled) {
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
