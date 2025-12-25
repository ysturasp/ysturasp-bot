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
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { Exam } from '../database/entities/exam.entity';
import { Poll } from '../database/entities/poll.entity';
import { PollAnswer } from '../database/entities/poll-answer.entity';
import { SupportRequest } from '../database/entities/support-request.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { formatSchedule } from '../helpers/schedule-formatter';
import { ConfigService } from '@nestjs/config';

@Update()
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Exam)
    private readonly examRepository: Repository<Exam>,
    @InjectRepository(Poll)
    private readonly pollRepository: Repository<Poll>,
    @InjectRepository(PollAnswer)
    private readonly pollAnswerRepository: Repository<PollAnswer>,
    @InjectRepository(SupportRequest)
    private readonly supportRequestRepository: Repository<SupportRequest>,
    private readonly scheduleService: ScheduleService,
    private readonly configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf,
  ) {}
  @Command('exams')
  async onExams(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id } },
    });
    if (!subs.length) {
      await ctx.reply(
        '❌ У вас нет активных подписок. Используйте /subscribe чтобы добавить группу.',
      );
      return;
    }

    const formatDate = (isoDate: string): string => {
      const date = new Date(isoDate);
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
    };

    let foundAny = false;
    let msg = '';
    for (const sub of subs) {
      const normalizedGroupName = sub.groupName.trim().toLowerCase();
      const exams = await this.examRepository
        .createQueryBuilder('exam')
        .where('LOWER(exam.groupName) = :groupName', {
          groupName: normalizedGroupName,
        })
        .orderBy('exam.date', 'ASC')
        .getMany();

      if (!exams.length) {
        continue;
      }
      foundAny = true;
      msg += `🎓 <b>Экзамены для группы ${sub.groupName}</b>\n\n`;
      for (const exam of exams) {
        msg += `📚 ${exam.lessonName}\n🕐 ${formatDate(exam.date)}\n${exam.teacherName ? '👨‍🏫 ' + exam.teacherName + '\n' : ''}${exam.auditoryName ? '🏛 ' + exam.auditoryName + '\n' : ''}\n`;
      }
      msg += '\n';
    }
    if (foundAny) {
      await ctx.reply(msg.trim(), { parse_mode: 'HTML' });
    } else {
      await ctx.reply('Экзамены для ваших групп не найдены.');
    }
  }

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
      ...this.getMainKeyboard(),
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

  @Action(/^quick_sub:(.+)$/)
  async onQuickSubscribe(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    const user = await this.getUser(ctx);

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

  @Action(/^quick_view:(.+)$/)
  async onQuickView(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];

    await ctx.answerCbQuery();

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📅 Сегодня', `view_day:${groupName}:0`)],
      [Markup.button.callback('📅 Завтра', `view_day:${groupName}:1`)],
      [Markup.button.callback('📅 Неделя', `view_week:${groupName}`)],
      [Markup.button.callback('« Назад', `back_to_group:${groupName}`)],
    ]);

    await ctx.editMessageText(
      `📋 Расписание для группы ${groupName}:`,
      keyboard,
    );
  }

  @Action(/^view_day:(.+):(\d+)$/)
  async onViewDay(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];
    // @ts-ignore
    const dayOffset = parseInt(ctx.match[2]);

    await ctx.answerCbQuery();

    const schedule = await this.scheduleService.getSchedule(groupName);
    const message = formatSchedule(schedule, dayOffset, groupName);

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '« Назад к выбору дня',
          `quick_view:${groupName}`,
        ),
      ],
    ]);

    await ctx.editMessageText(message, keyboard);
  }

  @Action(/^view_week:(.+)$/)
  async onViewWeek(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];

    await ctx.answerCbQuery();

    const schedule = await this.scheduleService.getSchedule(groupName);
    const message = formatSchedule(schedule, 'week', groupName);

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '« Назад к выбору дня',
          `quick_view:${groupName}`,
        ),
      ],
    ]);

    await ctx.editMessageText(message, keyboard);
  }

  @Action(/^back_to_group:(.+)$/)
  async onBackToGroup(@Ctx() ctx: Context) {
    // @ts-ignore
    const groupName = ctx.match[1];

    const user = await this.getUser(ctx);
    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);

    await ctx.answerCbQuery();

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '🔔 Подписаться на уведомления',
          `quick_sub:${groupName}`,
        ),
      ],
      [
        Markup.button.callback(
          '📅 Посмотреть расписание',
          `quick_view:${groupName}`,
        ),
      ],
    ]);

    await ctx.editMessageText(
      `✅ Нашёл группу <b>${groupName}</b>!\n\nЧто вы хотите сделать?`,
      { parse_mode: 'HTML', ...keyboard },
    );
  }

  @Action('back_to_subscribe')
  async onBackToSubscribe(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    user.state = 'WAITING_GROUP_SUBSCRIBE';
    user.stateData = null;
    await this.userRepository.save(user);

    await ctx.answerCbQuery();

    await ctx.editMessageText('Введите название группы (например, ЦИС-33):');
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

  @Command('support')
  async onSupport(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    user.state = 'SUPPORT';
    await this.userRepository.save(user);
    await ctx.reply(
      'Пожалуйста, введите ваш запрос в следующем сообщении (допускается одна фотография)',
    );
  }

  @Command('suggestion')
  async onSuggestion(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    user.state = 'SUGGESTION';
    await this.userRepository.save(user);
    await ctx.reply(
      'Пожалуйста, введите ваше предложение в следующем сообщении (допускается одна фотография)',
    );
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
    const user = await this.getUser(ctx);
    const subs = await this.subscriptionRepository.find({
      where: { user: { id: user.id }, isActive: true },
    });

    if (subs.length === 0) {
      await ctx.reply(
        'У вас нет активных подписок. Используйте /subscribe чтобы подписаться на уведомления.',
      );
      return;
    }

    for (const sub of subs) {
      try {
        const schedule = await this.scheduleService.getSchedule(sub.groupName);
        if (!schedule) continue;

        const now = new Date();
        let closestLesson = null;
        let closestDate = null;
        let minTimeDiff = Infinity;

        for (const week of schedule.items) {
          for (const day of week.days) {
            const dayDate = new Date(day.info.date);
            if (dayDate < now) continue;

            for (const lesson of day.lessons || []) {
              const lessonStart = new Date(lesson.startAt);
              const timeDiff = lessonStart.getTime() - now.getTime();

              if (timeDiff > 0 && timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestLesson = lesson;
                closestDate = dayDate;
              }
            }
          }
        }

        if (closestLesson && closestDate) {
          const formattedDate = closestDate.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
          const daysOfWeek = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
          const dayOfWeek = daysOfWeek[closestDate.getDay()];

          const testMsg =
            '🔔 ТЕСТОВОЕ Напоминание о занятии:\n\n' +
            `👨‍💻 Группа: ${sub.groupName}\n` +
            `📅 Дата: ${dayOfWeek} (${formattedDate})\n` +
            `📚 Предмет: ${closestLesson.lessonName}\n` +
            `📝 Тип: ${this.getLessonTypeName(closestLesson.type)}\n` +
            `🕐 Время: ${closestLesson.timeRange}\n` +
            (closestLesson.teacherName
              ? `👨‍🏫 Преподаватель: ${closestLesson.teacherName}\n`
              : '') +
            (closestLesson.auditoryName
              ? `🏛 Аудитория: ${closestLesson.auditoryName}\n`
              : '') +
            `\n⚠️ Это тестовое уведомление. Реальные уведомления будут приходить за ${sub.notifyMinutes} минут до начала занятия.`;

          await ctx.reply(testMsg);
        } else {
          await ctx.reply(
            `❌ Не удалось найти предстоящие пары в расписании группы ${sub.groupName}`,
          );
        }
      } catch (e) {
        this.logger.error(
          `Ошибка при получении расписания группы ${sub.groupName}`,
          e,
        );
        await ctx.reply(
          `❌ Ошибка при получении расписания группы ${sub.groupName}`,
        );
      }
    }

    await ctx.reply('Тестовые уведомления отправлены для всех ваших подписок.');
  }

  @Command('createpoll')
  async onCreatePoll(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    if (!user.isAdmin) {
      await ctx.reply('❌ Эта команда доступна только администраторам.');
      return;
    }

    user.state = 'POLL_QUESTION';
    await this.userRepository.save(user);
    await ctx.reply('Введите вопрос для опроса:');
  }

  @Command('broadcast')
  async onBroadcast(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
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

    await this.broadcastToAllUsers(broadcastText, ctx);
  }

  @Command('reply')
  async onReply(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
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

    try {
      await ctx.telegram.sendMessage(
        targetChatId,
        '📩 Ответ от поддержки:\n' + replyText,
      );

      const request = await this.supportRequestRepository.findOne({
        where: { userId: targetChatId },
        order: { createdAt: 'DESC' },
      });

      if (request) {
        request.messages.push({
          message: replyText,
          createdAt: new Date().toISOString(),
          isAdmin: true,
        });
        request.status = 'answered';
        request.lastMessageAt = new Date();
        await this.supportRequestRepository.save(request);
      }

      await ctx.reply('Ответ отправлен!');
    } catch (e) {
      await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
    }
  }

  @Command('replyPhoto')
  async onReplyPhoto(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
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

    user.state = 'ADMIN_REPLY_PHOTO';
    user.stateData = { targetChatId, replyText };
    await this.userRepository.save(user);
    await ctx.reply('Теперь отправьте фото для ответа');
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    // @ts-ignore
    const text = ctx.message.text;
    const user = await this.getUser(ctx);

    if (
      text === '📅 Сегодня' ||
      text === '/today' ||
      text.toLowerCase() === 'сегодня'
    ) {
      return this.handleScheduleRequest(ctx, user, 0);
    }
    if (
      text === '📅 Завтра' ||
      text === '/tomorrow' ||
      text.toLowerCase() === 'завтра'
    ) {
      return this.handleScheduleRequest(ctx, user, 1);
    }
    if (
      text === '📅 Неделя' ||
      text === '/week' ||
      text.toLowerCase() === 'неделя'
    ) {
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

      const existing = await this.subscriptionRepository.findOne({
        where: { user: { id: user.id }, groupName },
      });
      if (existing) {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        await ctx.reply(`⚠️ Вы уже подписаны на группу <b>${groupName}</b>.`, {
          parse_mode: 'HTML',
          ...this.getMainKeyboard(),
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                'Выбрать другую группу',
                'back_to_subscribe',
              ),
            ],
          ]),
        });
        return;
      }

      user.state = 'WAITING_NOTIFY_TIME';
      user.stateData = { pendingGroup: groupName };
      await this.userRepository.save(user);

      await ctx.reply(
        `✅ Группа ${groupName} найдена!\n\nЗа сколько минут до начала занятия присылать уведомление? (Напишите число, например 30)`,
      );
    } else if (user.state === 'WAITING_NOTIFY_TIME') {
      const minutes = parseInt(text);
      if (isNaN(minutes) || minutes < 1) {
        await ctx.reply(
          '⚠️ Пожалуйста, введите корректное число минут (больше 0):',
        );
        return;
      }

      const groupName = user.stateData?.pendingGroup;
      if (!groupName) {
        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        await ctx.reply(
          '⚠️ Произошла ошибка (потерян контекст). Начните заново нажав /subscribe',
        );
        return;
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
          ...this.getMainKeyboard(),
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                'Выбрать другую группу',
                'back_to_subscribe',
              ),
            ],
          ]),
        });
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
        `✅ Готово! Вы подписались на расписание группы <b>${groupName}</b>.\n⏰ Уведомления будут приходить за <b>${minutes} мин</b> до начала пары.`,
        { parse_mode: 'HTML', ...this.getMainKeyboard() },
      );
    } else if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      const type = user.state === 'SUPPORT' ? 'Проблема' : 'Предложение';
      const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');

      const request = this.supportRequestRepository.create({
        userId: user.chatId,
        messages: [
          {
            message: text,
            createdAt: new Date().toISOString(),
            isAdmin: false,
          },
        ],
        status: 'pending',
        lastMessageAt: new Date(),
      });
      await this.supportRequestRepository.save(request);

      const name =
        `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
        'Пользователь';
      const username = user.username ? `@${user.username}` : 'нет username';

      await ctx.telegram.sendMessage(
        adminChatId,
        `📩 Новая ${type} от ${name} (${username}):\n${text}\n\nОтветьте командой:\n/reply ${user.chatId} ваш_ответ`,
      );

      user.state = null;
      await this.userRepository.save(user);
      await ctx.reply('Ваше сообщение отправлено в поддержку. Спасибо!');
    } else if (user.state === 'POLL_QUESTION' && user.isAdmin) {
      user.state = 'POLL_OPTIONS';
      user.stateData = { pollQuestion: text };
      await this.userRepository.save(user);
      await ctx.reply(
        'Введите варианты ответов через запятую (например: Да, Нет, Может быть):',
      );
    } else if (user.state === 'POLL_OPTIONS' && user.isAdmin) {
      const options = text.split(',').map((opt) => opt.trim());
      if (options.length < 2) {
        await ctx.reply(
          'Пожалуйста, введите как минимум 2 варианта ответа, разделенных запятой:',
        );
        return;
      }

      user.state = 'POLL_IMAGE';
      user.stateData = {
        pollQuestion: user.stateData.pollQuestion,
        pollOptions: options,
      };
      await this.userRepository.save(user);
      await ctx.reply(
        'Хотите добавить изображение к опросу? Отправьте фото или напишите "нет":',
      );
    } else if (user.state === 'POLL_IMAGE' && user.isAdmin) {
      if (text.toLowerCase() === 'нет') {
        const poll = this.pollRepository.create({
          question: user.stateData.pollQuestion,
          options: user.stateData.pollOptions,
          imageFileId: null,
          isActive: true,
        });
        await this.pollRepository.save(poll);

        user.state = 'POLL_BROADCAST';
        user.stateData = { pollId: poll.id };
        await this.userRepository.save(user);
        await ctx.reply(
          'Опрос создан! Хотите разослать его всем пользователям? (да/нет)',
        );
      } else {
        await ctx.reply('Пожалуйста, отправьте фото или напишите "нет":');
      }
    } else if (user.state === 'POLL_BROADCAST' && user.isAdmin) {
      if (text.toLowerCase() === 'да') {
        const pollId = user.stateData.pollId;
        const result = await this.broadcastPoll(pollId);
        await ctx.reply(
          `Опрос разослан:\nУспешно: ${result.success}\nОшибок: ${result.failed}`,
        );
      } else {
        const pollId = user.stateData.pollId;
        await ctx.reply(
          `Опрос сохранен. Вы можете разослать его позже командой:\n/sendpoll ${pollId}`,
        );
      }

      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
    } else {
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
      } else {
        const helpMsg = `Не удалось распознать команду или группу 🤔

Попробуйте:
• Введите название группы (например, ЦИС-33)
• Используйте кнопки внизу для расписания
• /subscribe — подписаться на уведомления

Есть вопрос? Напишите /support`;

        await ctx.reply(helpMsg, this.getMainKeyboard());
      }
    }
  }

  private async getUser(ctx: Context): Promise<User> {
    const chatId = String(ctx.chat.id);
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');
    let user = await this.userRepository.findOne({ where: { chatId } });
    if (!user) {
      user = this.userRepository.create({
        chatId,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
        isAdmin: chatId === adminChatId,
      });
      await this.userRepository.save(user);
    } else {
      if (user.isAdmin !== (chatId === adminChatId)) {
        user.isAdmin = chatId === adminChatId;
        await this.userRepository.save(user);
      }
      if (!user.username && ctx.from.username) {
        user.username = ctx.from.username;
        await this.userRepository.save(user);
      }
      if (!user.firstName && ctx.from.first_name) {
        user.firstName = ctx.from.first_name;
        await this.userRepository.save(user);
      }
      if (!user.lastName && ctx.from.last_name) {
        user.lastName = ctx.from.last_name;
        await this.userRepository.save(user);
      }
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

  @On('photo')
  async onPhoto(@Ctx() ctx: Context) {
    const user = await this.getUser(ctx);
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');
    const message = ctx.message as any;

    if (user.state === 'POLL_IMAGE' && user.isAdmin) {
      const photo = message.photo[message.photo.length - 1];
      const fileId = photo.file_id;

      const poll = this.pollRepository.create({
        question: user.stateData.pollQuestion,
        options: user.stateData.pollOptions,
        imageFileId: fileId,
        isActive: true,
      });
      await this.pollRepository.save(poll);

      user.state = 'POLL_BROADCAST';
      user.stateData = { pollId: poll.id };
      await this.userRepository.save(user);
      await ctx.reply(
        'Опрос с изображением создан! Хотите разослать его всем пользователям? (да/нет)',
      );
      return;
    }

    if (user.state === 'SUPPORT' || user.state === 'SUGGESTION') {
      const type = user.state === 'SUPPORT' ? 'Проблема' : 'Предложение';
      const photo = message.photo[message.photo.length - 1];
      const fileId = photo.file_id;
      const caption = message.caption || '';

      const request = this.supportRequestRepository.create({
        userId: user.chatId,
        messages: [
          {
            message: caption || '[ФОТО]',
            createdAt: new Date().toISOString(),
            isAdmin: false,
            mediaType: 'photo',
            fileId,
          },
        ],
        status: 'pending',
        lastMessageAt: new Date(),
      });
      await this.supportRequestRepository.save(request);

      const name =
        `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
        'Пользователь';
      const username = user.username ? `@${user.username}` : 'нет username';

      await ctx.telegram.sendPhoto(adminChatId, fileId, {
        caption: `📩 Новая ${type} от ${name} (${username})\nТекст: ${caption}`,
      });
      await ctx.telegram.sendMessage(
        adminChatId,
        `\nОтветьте командой:\n/reply ${user.chatId} ваш_ответ`,
      );

      user.state = null;
      await this.userRepository.save(user);
      await ctx.reply(
        'Ваша фотография и текст отправлены в поддержку. Спасибо!',
      );
      return;
    }

    if (user.isAdmin && message.caption?.startsWith('/broadcast')) {
      const photo = message.photo[message.photo.length - 1];
      const fileId = photo.file_id;
      const caption = message.caption.replace('/broadcast', '').trim();
      await this.broadcastPhotoToAllUsers(fileId, caption, ctx);
      return;
    }

    if (user.state === 'ADMIN_REPLY_PHOTO' && user.isAdmin) {
      const photo = message.photo[message.photo.length - 1];
      const fileId = photo.file_id;
      const targetChatId = user.stateData.targetChatId;
      const replyText = user.stateData.replyText;

      try {
        await ctx.telegram.sendPhoto(targetChatId, fileId, {
          caption: '📩 Ответ от поддержки:\n' + replyText,
        });

        const request = await this.supportRequestRepository.findOne({
          where: { userId: targetChatId },
          order: { createdAt: 'DESC' },
        });

        if (request) {
          request.messages.push({
            message: replyText,
            createdAt: new Date().toISOString(),
            isAdmin: true,
            mediaType: 'photo',
            fileId,
          });
          request.status = 'answered';
          request.lastMessageAt = new Date();
          await this.supportRequestRepository.save(request);
        }

        user.state = null;
        user.stateData = null;
        await this.userRepository.save(user);
        await ctx.reply('Ответ с фото отправлен!');
      } catch (e) {
        await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
      }
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
    const user = await this.getUser(ctx);
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

    const result = await this.broadcastPoll(pollId);
    await ctx.reply(
      `Опрос разослан:\nУспешно: ${result.success}\nОшибок: ${result.failed}`,
    );
  }

  private async broadcastToAllUsers(text: string, ctx: Context) {
    const users = await this.userRepository.find();
    let success = 0;
    let failed = 0;
    const blocked: string[] = [];

    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user.chatId, '📢 Объявление:\n' + text, {
          parse_mode: 'HTML',
        });
        success++;
      } catch (e: any) {
        failed++;
        if (e.response?.error_code === 403) {
          blocked.push(user.username || user.chatId);
        }
      }
    }

    await ctx.reply(
      `Сообщение отправлено ${success} пользователям.\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота:\n${blocked.join('\n')}` : ''}`,
    );
  }

  private async broadcastPhotoToAllUsers(
    fileId: string,
    caption: string,
    ctx: Context,
  ) {
    const users = await this.userRepository.find();
    let success = 0;
    let failed = 0;
    const blocked: string[] = [];

    for (const user of users) {
      try {
        await ctx.telegram.sendPhoto(user.chatId, fileId, {
          caption: '📢 Объявление:\n' + caption,
        });
        success++;
      } catch (e: any) {
        failed++;
        if (e.response?.error_code === 403) {
          blocked.push(user.username || user.chatId);
        }
      }
    }

    await ctx.reply(
      `Фото отправлено ${success} пользователям.\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота:\n${blocked.join('\n')}` : ''}`,
    );
  }

  private async broadcastPoll(pollId: number) {
    const poll = await this.pollRepository.findOne({ where: { id: pollId } });
    if (!poll || !poll.isActive) {
      return { success: 0, failed: 0 };
    }

    const users = await this.userRepository.find();
    let success = 0;
    let failed = 0;

    const keyboard = Markup.inlineKeyboard(
      poll.options.map((option) => [
        Markup.button.callback(option, `poll:${pollId}:${option}`),
      ]),
    );

    for (const user of users) {
      try {
        if (poll.imageFileId) {
          await this.bot.telegram.sendPhoto(user.chatId, poll.imageFileId, {
            caption: `📊 Опрос:\n${poll.question}`,
            reply_markup: keyboard.reply_markup,
          });
        } else {
          await this.bot.telegram.sendMessage(
            user.chatId,
            `📊 Опрос:\n${poll.question}`,
            {
              reply_markup: keyboard.reply_markup,
            },
          );
        }
        success++;
      } catch (e) {
        failed++;
      }
    }

    return { success, failed };
  }

  @Action(/^poll:(\d+):(.+)$/)
  async onPollAnswer(@Ctx() ctx: Context) {
    // @ts-ignore
    const pollId = parseInt(ctx.match[1]);
    // @ts-ignore
    const answer = ctx.match[2];
    const user = await this.getUser(ctx);
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');

    const existingAnswer = await this.pollAnswerRepository.findOne({
      where: { pollId, userId: user.id },
    });

    if (existingAnswer) {
      await ctx.answerCbQuery('Вы уже ответили на этот опрос!');
      return;
    }

    const pollAnswer = this.pollAnswerRepository.create({
      pollId,
      userId: user.id,
      answer,
    });
    await this.pollAnswerRepository.save(pollAnswer);

    const poll = await this.pollRepository.findOne({ where: { id: pollId } });
    if (poll) {
      const username = user.username ? `@${user.username}` : 'нет username';
      await ctx.telegram.sendMessage(
        adminChatId,
        `📊 Новый ответ на опрос!\n\nВопрос: ${poll.question}\nОт: ${username}\nОтвет: ${answer}`,
      );
    }

    await ctx.answerCbQuery('Спасибо за ваш ответ! 👍');
  }

  private getLessonTypeName(type: number): string {
    const LESSON_TYPES: Record<number, string> = {
      0: 'Нет типа',
      1: 'Курсовой проект',
      2: 'Лекция',
      3: 'Экзамен',
      4: 'Практика',
      5: 'Консультация',
      6: 'Лекция + Практика',
      7: 'Дифференцированный зачет',
      8: 'Лабораторная работа',
      9: 'Библиотека',
      10: 'Лекция + Лабораторная работа',
      11: 'Организационное собрание',
      12: 'Не поддерживается',
      256: 'Экзамен',
    };
    return LESSON_TYPES[type] || '';
  }
}
