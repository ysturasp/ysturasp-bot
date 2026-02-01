import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context, Markup } from 'telegraf';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { User } from '../../database/entities/user.entity';
import { SupportRequest } from '../../database/entities/support-request.entity';
import { EncryptionService } from './encryption.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportRequest)
    private readonly supportRequestRepository: Repository<SupportRequest>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    @InjectBot() private readonly bot: Telegraf,
  ) {}

  async handleSupportCommand(ctx: Context, user: User): Promise<void> {
    user.state = 'SUPPORT';
    await this.userRepository.save(user);

    const msg =
      'Пожалуйста, введите ваш запрос в следующем сообщении (допускается одна фотография или видео)';
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);
    let menuMessageId: number;
    if (
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery
    ) {
      const sent = await ctx.editMessageText?.(msg, kb as any);
      menuMessageId = (sent as any).message_id;
    } else {
      const sent = await ctx.reply(msg);
      menuMessageId = sent.message_id;
    }

    user.stateData = { ...user.stateData, menuMessageId };
    await this.userRepository.save(user);
  }

  async handleSuggestionCommand(ctx: Context, user: User): Promise<void> {
    user.state = 'SUGGESTION';
    await this.userRepository.save(user);

    const msg =
      'Пожалуйста, введите ваше предложение в следующем сообщении (допускается одна фотография или видео)';
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('« Назад', 'back_dynamic')],
    ]);
    let menuMessageId: number;
    if (
      (ctx as any).updateType === 'callback_query' ||
      (ctx as any).callbackQuery
    ) {
      const sent = await ctx.editMessageText?.(msg, kb as any);
      menuMessageId = (sent as any).message_id;
    } else {
      const sent = await ctx.reply(msg);
      menuMessageId = sent.message_id;
    }

    user.stateData = { ...user.stateData, menuMessageId };
    await this.userRepository.save(user);
  }

  async handleSupportText(ctx: Context, user: User, text: string) {
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
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Пользователь';
    const username = user.username ? `@${user.username}` : 'нет username';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };
    await ctx.telegram.sendMessage(
      adminChatId,
      `📩 Новая ${type} от ${name} (${username}):\n${text}`,
      kb as any,
    );

    if (user.stateData?.menuMessageId) {
      try {
        await ctx.telegram.deleteMessage(
          user.chatId,
          user.stateData.menuMessageId,
        );
      } catch (e) {}
    }

    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);
    await ctx.reply('Ваше сообщение отправлено в поддержку. Спасибо!');
  }

  async handleSupportPhoto(
    ctx: Context,
    user: User,
    fileId: string,
    caption: string,
  ) {
    const type = user.state === 'SUPPORT' ? 'Проблема' : 'Предложение';
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');

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
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Пользователь';
    const username = user.username ? `@${user.username}` : 'нет username';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };
    await ctx.telegram.sendPhoto(adminChatId, fileId, {
      caption: `📩 Новая ${type} от ${name} (${username})\nТекст: ${caption}`,
      ...kb,
    });

    if (user.stateData?.menuMessageId) {
      try {
        await ctx.telegram.deleteMessage(
          user.chatId,
          user.stateData.menuMessageId,
        );
      } catch (e) {}
    }

    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);
    await ctx.reply('Ваша фотография и текст отправлены в поддержку. Спасибо!');
  }

  async handleSupportVideo(
    ctx: Context,
    user: User,
    fileId: string,
    caption: string,
  ) {
    const type = user.state === 'SUPPORT' ? 'Проблема' : 'Предложение';
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');

    const request = this.supportRequestRepository.create({
      userId: user.chatId,
      messages: [
        {
          message: caption || '[ВИДЕО]',
          createdAt: new Date().toISOString(),
          isAdmin: false,
          mediaType: 'video',
          fileId,
        },
      ],
      status: 'pending',
      lastMessageAt: new Date(),
    });
    await this.supportRequestRepository.save(request);

    const name =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Пользователь';
    const username = user.username ? `@${user.username}` : 'нет username';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };
    await ctx.telegram.sendVideo(adminChatId, fileId, {
      caption: `📩 Новая ${type} от ${name} (${username})\nТекст: ${caption}`,
      ...kb,
    });

    if (user.stateData?.menuMessageId) {
      try {
        await ctx.telegram.deleteMessage(
          user.chatId,
          user.stateData.menuMessageId,
        );
      } catch (e) {}
    }

    user.state = null;
    user.stateData = null;
    await this.userRepository.save(user);
    await ctx.reply('Ваше видео и текст отправлены в поддержку. Спасибо!');
  }

  async handleReplyCommand(
    ctx: Context,
    targetChatId: string,
    replyText: string,
  ) {
    try {
      const replyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Ответить', 'user_reply_to_admin')],
      ]);

      await ctx.telegram.sendMessage(
        targetChatId,
        '📩 Ответ от поддержки:\n' + replyText,
        replyKeyboard,
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

      try {
        const adminChatId = String(ctx.chat.id);
        const adminUser = await this.userRepository.findOne({
          where: { chatId: adminChatId },
        });
        if (adminUser) {
          adminUser.state = null;
          adminUser.stateData = null;
          await this.userRepository.save(adminUser);
        }
      } catch (e) {
        this.logger.debug('Failed to clear admin state after reply');
      }

      await ctx.reply('Ответ отправлен!');
    } catch (e) {
      await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
    }
  }

  async handleReplyPhotoCommand(
    ctx: Context,
    user: User,
    targetChatId: string,
    replyText: string,
  ): Promise<void> {
    user.state = 'ADMIN_REPLY_PHOTO';
    user.stateData = { targetChatId, replyText };
    await ctx.reply('Теперь отправьте фото для ответа');
  }

  async prepareAdminReply(ctx: Context, user: User, targetChatId: string) {
    user.state = 'ADMIN_REPLY';
    user.stateData = { targetChatId };
    await this.userRepository.save(user);
    await ctx.reply(
      `Отвечаете пользователю (chatId: ${targetChatId}). Введите текст ответа:`,
    );
  }

  async handleReplyPhoto(ctx: Context, user: User, fileId: string) {
    const targetChatId = user.stateData.targetChatId;
    const replyText = user.stateData.replyText;

    try {
      const replyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Ответить', 'user_reply_to_admin')],
      ]);

      await ctx.telegram.sendPhoto(targetChatId, fileId, {
        caption: '📩 Ответ от поддержки:\n' + replyText,
        ...replyKeyboard,
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
  }

  async handleWebReplyCommand(
    ctx: Context,
    requestId: string,
    replyText: string,
  ) {
    try {
      const request = await this.supportRequestRepository.findOne({
        where: { id: requestId },
      });

      if (!request) {
        await ctx.reply('Обращение не найдено');
        return;
      }

      request.messages.push({
        message: replyText,
        createdAt: new Date().toISOString(),
        isAdmin: true,
      });
      request.status = 'answered';
      request.lastMessageAt = new Date();
      await this.supportRequestRepository.save(request);

      if (request.userId) {
        try {
          await this.bot.telegram.sendMessage(
            request.userId,
            '📩 Ответ от поддержки:\n' + replyText,
          );
        } catch (e) {
          this.logger.error(`Failed to send web reply to ${request.userId}`, e);
          await ctx.reply(
            '⚠️ Ответ сохранен, но не удалось отправить пользователю. Возможно, пользователь заблокировал бота.',
          );
          return;
        }
      }

      await ctx.reply('Ответ успешно отправлен');
    } catch (e) {
      this.logger.error('Error handling web reply', e);
      await ctx.reply('Ошибка при отправке ответа.');
    }
  }

  async handleWebSupportRequest(
    userId: string,
    message: string,
    isSecurityReport: boolean = false,
  ): Promise<SupportRequest> {
    const request = this.supportRequestRepository.create({
      userId,
      messages: [
        {
          message,
          createdAt: new Date().toISOString(),
          isAdmin: false,
        },
      ],
      status: 'pending',
      lastMessageAt: new Date(),
      source: 'web',
      isSecurityReport,
    });

    const savedRequest = await this.supportRequestRepository.save(request);

    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');
    if (adminChatId) {
      let adminMessage: string;
      if (isSecurityReport && message.startsWith('[SECURITY] ')) {
        try {
          const encryptedMsg = message.slice('[SECURITY] '.length);
          const decryptedMsg = this.encryptionService.decrypt(encryptedMsg);
          adminMessage = `🔒 Новое сообщение о уязвимости:\n${decryptedMsg}\n\nОтветьте командой:\n/webreply ${savedRequest.id} ваш_ответ`;
        } catch (e: any) {
          const encryptedMsg = message.slice('[SECURITY] '.length);
          adminMessage = `🔒 Новое сообщение о уязвимости\n\n❌ ${e.message}\n\nЗашифрованное сообщение:\n${encryptedMsg}\n\nОтветьте командой:\n/webreply ${savedRequest.id} ваш_ответ`;
        }
      } else {
        adminMessage = `📩 Новое обращение с сайта:\n${message}\n\nОтветьте командой:\n/webreply ${savedRequest.id} ваш_ответ`;
      }

      try {
        await this.bot.telegram.sendMessage(adminChatId, adminMessage);
      } catch (e) {
        this.logger.error('Failed to send admin notification', e);
      }
    }

    return savedRequest;
  }

  async handleWebReply(
    userId: string,
    requestId: string,
    message: string,
  ): Promise<SupportRequest | null> {
    const request = await this.supportRequestRepository.findOne({
      where: { id: requestId, userId },
    });

    if (!request) {
      return null;
    }

    request.messages.push({
      message,
      createdAt: new Date().toISOString(),
      isAdmin: false,
    });
    request.lastMessageAt = new Date();
    await this.supportRequestRepository.save(request);

    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');
    if (adminChatId) {
      try {
        await this.bot.telegram.sendMessage(
          adminChatId,
          `📩 Новое сообщение в обращении ${requestId}:\n${message}\n\nОтветьте командой:\n/webreply ${requestId} ваш_ответ`,
        );
      } catch (e) {
        this.logger.error('Failed to send admin notification', e);
      }
    }

    return request;
  }

  async getWebRequests(userId: string): Promise<SupportRequest[]> {
    return await this.supportRequestRepository.find({
      where: { userId, source: 'web' },
      order: { lastMessageAt: 'DESC' },
    });
  }
}
