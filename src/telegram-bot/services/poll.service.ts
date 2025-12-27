import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context, Markup } from 'telegraf';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { Poll } from '../../database/entities/poll.entity';
import { PollAnswer } from '../../database/entities/poll-answer.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PollService {
  private readonly logger = new Logger(PollService.name);

  constructor(
    @InjectRepository(Poll)
    private readonly pollRepository: Repository<Poll>,
    @InjectRepository(PollAnswer)
    private readonly pollAnswerRepository: Repository<PollAnswer>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectBot() private readonly bot: Telegraf,
    private readonly configService: ConfigService,
  ) {}

  async handleCreatePollCommand(ctx: Context, user: User) {
    user.state = 'POLL_QUESTION';
    await this.userRepository.save(user);
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);
    const isCallback =
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery;
    if (isCallback) {
      try {
        await ctx.editMessageText('Введите вопрос для опроса:', kb as any);
        return;
      } catch (e) {}
    }
    await ctx.reply('Введите вопрос для опроса:', kb as any);
  }

  async handlePollQuestion(
    ctx: Context,
    user: User,
    text: string,
  ): Promise<void> {
    user.state = 'POLL_OPTIONS';
    user.stateData = { pollQuestion: text };
    await this.userRepository.save(user);
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);
    const isCallback =
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery;
    if (isCallback) {
      try {
        await ctx.editMessageText(
          'Введите варианты ответов через запятую (например: Да, Нет, Может быть):',
          kb as any,
        );
        return;
      } catch (e) {}
    }
    await ctx.reply(
      'Введите варианты ответов через запятую (например: Да, Нет, Может быть):',
      kb as any,
    );
  }

  async handlePollOptions(
    ctx: Context,
    user: User,
    text: string,
  ): Promise<boolean> {
    const options = text.split(',').map((opt) => opt.trim());
    if (options.length < 2) {
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('« Назад', 'back_dynamic')],
      ]);
      const isCallback =
        (ctx as any).updateType === 'callback_query' ||
        (ctx as any).callbackQuery;
      if (isCallback) {
        try {
          await ctx.editMessageText(
            'Пожалуйста, введите как минимум 2 варианта ответа, разделенных запятой:',
            kb as any,
          );
          return false;
        } catch (e) {}
      }
      await ctx.reply(
        'Пожалуйста, введите как минимум 2 варианта ответа, разделенных запятой:',
        kb as any,
      );
      return false;
    }

    user.state = 'POLL_IMAGE';
    user.stateData = {
      pollQuestion: user.stateData.pollQuestion,
      pollOptions: options,
    };
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
          'Хотите добавить изображение к опросу? Отправьте фото или напишите "нет":',
          kb2 as any,
        );
        return true;
      } catch (e) {}
    }
    await ctx.reply(
      'Хотите добавить изображение к опросу? Отправьте фото или напишите "нет":',
      kb2 as any,
    );
    return true;
  }

  async handlePollImage(ctx: Context, user: User, text: string): Promise<void> {
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
      const kb3 = Markup.inlineKeyboard([
        [Markup.button.callback('« Назад', 'back_dynamic')],
      ]);
      const isCallback3 =
        (ctx as any).updateType === 'callback_query' ||
        (ctx as any).callbackQuery;
      if (isCallback3) {
        try {
          await ctx.editMessageText(
            'Опрос создан! Хотите разослать его всем пользователям? (да/нет)',
            kb3 as any,
          );
          return;
        } catch (e) {}
      }
      await ctx.reply(
        'Опрос создан! Хотите разослать его всем пользователям? (да/нет)',
        kb3 as any,
      );
    } else {
      await ctx.reply('Пожалуйста, отправьте фото или напишите "нет":');
    }
  }

  async handlePollPhoto(
    ctx: Context,
    user: User,
    fileId: string,
  ): Promise<void> {
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
    const kb4 = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);
    const isCallback4 =
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery;
    if (isCallback4) {
      try {
        await ctx.editMessageText(
          'Опрос с изображением создан! Хотите разослать его всем пользователям? (да/нет)',
          kb4 as any,
        );
        return;
      } catch (e) {}
    }
    await ctx.reply(
      'Опрос с изображением создан! Хотите разослать его всем пользователям? (да/нет)',
      kb4 as any,
    );
  }

  async handlePollBroadcast(
    ctx: Context,
    user: User,
    text: string,
  ): Promise<void> {
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
  }

  async handleSendPollCommand(ctx: Context, pollId: number) {
    const result = await this.broadcastPoll(pollId);
    await ctx.reply(
      `Опрос разослан:\nУспешно: ${result.success}\nОшибок: ${result.failed}`,
    );
  }

  async handlePollAnswer(
    ctx: Context,
    pollId: number,
    answer: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { chatId: String(ctx.chat?.id) },
    });
    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден');
      return;
    }

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
      const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');
      const username = user.username ? `@${user.username}` : 'нет username';
      await this.bot.telegram.sendMessage(
        adminChatId,
        `📊 Новый ответ на опрос!\n\nВопрос: ${poll.question}\nОт: ${username}\nОтвет: ${answer}`,
      );
    }

    await ctx.answerCbQuery('Спасибо за ваш ответ! 👍');
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
}
