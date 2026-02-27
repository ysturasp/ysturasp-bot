import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Context, Markup } from 'telegraf';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { User } from '../../database/entities/user.entity';
import { SupportRequest } from '../../database/entities/support-request.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { EncryptionService } from './encryption.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportRequest)
    private readonly supportRequestRepository: Repository<SupportRequest>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly entityManager: EntityManager,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    @InjectBot() private readonly bot: Telegraf,
  ) {}

  private async getUserInfoForAdmin(user: User): Promise<string> {
    const name =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Пользователь';
    const username = user.username ? `@${user.username}` : 'нет username';

    let info = `👤 <b>Пользователь:</b> ${name} (${username})\n`;
    info += `🆔 <b>Chat ID:</b> <code>${user.chatId}</code>\n`;

    if (user.preferredGroup) {
      info += `📚 <b>Выбранная группа:</b> ${user.preferredGroup}\n`;
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

  async handleSupportCommand(ctx: Context, user: User): Promise<void> {
    user.state = 'SUPPORT';
    await this.userRepository.save(user);

    const msg =
      'Пожалуйста, введите ваш запрос в следующем сообщении (допускается фото, видео, кружок, стикер или голосовое сообщение)';
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('« Назад', 'back_dynamic'),
        Markup.button.callback('❌ Отмена', 'cancel_state'),
      ],
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
      'Пожалуйста, введите ваше предложение в следующем сообщении (допускается фото, видео, кружок, стикер или голосовое сообщение)';
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('« Назад', 'back_dynamic'),
        Markup.button.callback('❌ Отмена', 'cancel_state'),
      ],
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

    const userInfo = await this.getUserInfoForAdmin(user);

    const replyMessage = 'Ваше сообщение отправлено в поддержку. Спасибо!';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };

    const adminMessage = `📩 <b>Новая ${type}</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Запрос:</b>\n${text}\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;

    await ctx.telegram.sendMessage(adminChatId, adminMessage, {
      parse_mode: 'HTML',
      ...kb,
    } as any);

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
    await ctx.reply(replyMessage);
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

    const userInfo = await this.getUserInfoForAdmin(user);

    const replyMessage =
      'Ваша фотография и текст отправлены в поддержку. Спасибо!';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };

    const photoCaption = `📩 <b>Новая ${type}</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Запрос (фото):</b>\n${caption || '[без текста]'}\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;

    await ctx.telegram.sendPhoto(adminChatId, fileId, {
      caption: photoCaption,
      parse_mode: 'HTML',
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
    await ctx.reply(replyMessage);
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

    const userInfo = await this.getUserInfoForAdmin(user);

    const replyMessage = 'Ваше видео и текст отправлены в поддержку. Спасибо!';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };

    const videoCaption = `📩 <b>Новая ${type}</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Запрос (видео):</b>\n${caption || '[без текста]'}\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;

    await ctx.telegram.sendVideo(adminChatId, fileId, {
      caption: videoCaption,
      parse_mode: 'HTML',
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
    await ctx.reply(replyMessage);
  }

  async handleSupportSticker(ctx: Context, user: User, fileId: string) {
    const type = user.state === 'SUPPORT' ? 'Проблема' : 'Предложение';
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');

    const request = this.supportRequestRepository.create({
      userId: user.chatId,
      messages: [
        {
          message: '[СТИКЕР]',
          createdAt: new Date().toISOString(),
          isAdmin: false,
          mediaType: 'sticker',
          fileId,
        },
      ],
      status: 'pending',
      lastMessageAt: new Date(),
    });
    await this.supportRequestRepository.save(request);

    const userInfo = await this.getUserInfoForAdmin(user);

    const replyMessage = 'Ваш стикер отправлен в поддержку. Спасибо!';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };

    await ctx.telegram.sendSticker(adminChatId, fileId);
    await ctx.telegram.sendMessage(
      adminChatId,
      `📩 <b>Новая ${type}</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Запрос (стикер)</b>\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`,
      { parse_mode: 'HTML', ...kb },
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
    await ctx.reply(replyMessage);
  }

  async handleSupportVoice(
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
          message: caption || '[ГОЛОСОВОЕ СООБЩЕНИЕ]',
          createdAt: new Date().toISOString(),
          isAdmin: false,
          mediaType: 'voice',
          fileId,
        },
      ],
      status: 'pending',
      lastMessageAt: new Date(),
    });
    await this.supportRequestRepository.save(request);

    const userInfo = await this.getUserInfoForAdmin(user);

    const replyMessage =
      'Ваше голосовое сообщение отправлено в поддержку. Спасибо!';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };

    const voiceCaption = `📩 <b>Новая ${type}</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Запрос (голосовое):</b>\n${caption || '[без текста]'}\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`;

    await ctx.telegram.sendVoice(adminChatId, fileId, {
      caption: voiceCaption,
      parse_mode: 'HTML',
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
    await ctx.reply(replyMessage);
  }

  async handleSupportVideoNote(ctx: Context, user: User, fileId: string) {
    const type = user.state === 'SUPPORT' ? 'Проблема' : 'Предложение';
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');

    const request = this.supportRequestRepository.create({
      userId: user.chatId,
      messages: [
        {
          message: '[ВИДЕО-КРУЖОК]',
          createdAt: new Date().toISOString(),
          isAdmin: false,
          mediaType: 'video_note',
          fileId,
        },
      ],
      status: 'pending',
      lastMessageAt: new Date(),
    });
    await this.supportRequestRepository.save(request);

    const userInfo = await this.getUserInfoForAdmin(user);

    const replyMessage = 'Ваш видео-кружок отправлен в поддержку. Спасибо!';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Ответить', callback_data: `admin_reply:${user.chatId}` }],
        ],
      },
    };

    await ctx.telegram.sendVideoNote(adminChatId, fileId);
    await ctx.telegram.sendMessage(
      adminChatId,
      `📩 <b>Новая ${type}</b>\n\n${userInfo}\n━━━━━━━━━━━━━━━\n<b>📝 Запрос (видео-кружок)</b>\n\n<b>✅ Ответ пользователю:</b>\n${replyMessage}`,
      { parse_mode: 'HTML', ...kb },
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
    await ctx.reply(replyMessage);
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
    } catch (e: any) {
      this.logger.error(`Failed to send support reply to ${targetChatId}`, e);

      const user =
        (await this.userRepository.findOne({
          where: { chatId: targetChatId },
        })) || null;

      const isBlockedError =
        e.response?.error_code === 403 ||
        e.message?.includes('bot was blocked');

      if (user && isBlockedError) {
        if (!user.isBlocked) {
          user.isBlocked = true;
          await this.userRepository.save(user);
        }

        await ctx.reply(
          '⚠️ Ответ не доставлен: пользователь заблокировал бота или отключил переписку.',
        );
      } else {
        await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
      }
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
      `Отвечаете пользователю (chatId: ${targetChatId}). Отправьте текст, фото, кружок, стикер или голосовое. Для фото: /replyPhoto, для кружка: /replyVideoNote, для стикера: /replySticker, для голоса: /replyVoice chat_id [текст].`,
    );
  }

  async handleReplyPhoto(
    ctx: Context,
    user: User,
    fileId: string,
    replyTextOverride?: string,
  ) {
    const targetChatId = user.stateData?.targetChatId;
    const replyText =
      replyTextOverride ??
      (user.stateData && (user.stateData as any).replyText) ??
      '';

    try {
      if (!targetChatId) {
        await ctx.reply('Ошибка: не найден получатель для ответа.');
        return;
      }

      const replyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Ответить', 'user_reply_to_admin')],
      ]);

      await ctx.telegram.sendPhoto(targetChatId, fileId, {
        caption:
          '📩 Ответ от поддержки:\n' +
          (replyText && replyText.trim().length > 0
            ? replyText
            : '[без текста]'),
        ...replyKeyboard,
      });

      const request = await this.supportRequestRepository.findOne({
        where: { userId: targetChatId },
        order: { createdAt: 'DESC' },
      });

      if (request) {
        request.messages.push({
          message:
            replyText && replyText.trim().length > 0 ? replyText : '[ФОТО]',
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
    } catch (e: any) {
      this.logger.error(
        `Failed to send support photo reply to ${targetChatId}`,
        e,
      );

      const targetUser =
        (await this.userRepository.findOne({
          where: { chatId: targetChatId },
        })) || null;

      const isBlockedError =
        e.response?.error_code === 403 ||
        e.message?.includes('bot was blocked');

      if (targetUser && isBlockedError) {
        if (!targetUser.isBlocked) {
          targetUser.isBlocked = true;
          await this.userRepository.save(targetUser);
        }

        await ctx.reply(
          '⚠️ Ответ не доставлен: пользователь заблокировал бота или отключил переписку.',
        );
      } else {
        await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
      }
    }
  }

  async handleReplyStickerCommand(
    ctx: Context,
    user: User,
    targetChatId: string,
  ): Promise<void> {
    user.state = 'ADMIN_REPLY_STICKER';
    user.stateData = { targetChatId };
    await this.userRepository.save(user);
    await ctx.reply('Теперь отправьте стикер для ответа');
  }

  async handleReplySticker(ctx: Context, user: User, fileId: string) {
    const targetChatId = user.stateData?.targetChatId;

    try {
      if (!targetChatId) {
        await ctx.reply('Ошибка: не найден получатель для ответа.');
        return;
      }

      const replyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Ответить', 'user_reply_to_admin')],
      ]);

      await ctx.telegram.sendSticker(targetChatId, fileId, replyKeyboard);

      const request = await this.supportRequestRepository.findOne({
        where: { userId: targetChatId },
        order: { createdAt: 'DESC' },
      });

      if (request) {
        request.messages.push({
          message: '[СТИКЕР]',
          createdAt: new Date().toISOString(),
          isAdmin: true,
          mediaType: 'sticker',
          fileId,
        });
        request.status = 'answered';
        request.lastMessageAt = new Date();
        await this.supportRequestRepository.save(request);
      }

      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply('Ответ со стикером отправлен!');
    } catch (e: any) {
      this.logger.error(
        `Failed to send support sticker reply to ${targetChatId}`,
        e,
      );

      const targetUser =
        (await this.userRepository.findOne({
          where: { chatId: targetChatId },
        })) || null;

      const isBlockedError =
        e.response?.error_code === 403 ||
        e.message?.includes('bot was blocked');

      if (targetUser && isBlockedError) {
        if (!targetUser.isBlocked) {
          targetUser.isBlocked = true;
          await this.userRepository.save(targetUser);
        }

        await ctx.reply(
          '⚠️ Ответ не доставлен: пользователь заблокировал бота или отключил переписку.',
        );
      } else {
        await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
      }
    }
  }

  async handleReplyVoiceCommand(
    ctx: Context,
    user: User,
    targetChatId: string,
    replyText: string,
  ): Promise<void> {
    user.state = 'ADMIN_REPLY_VOICE';
    user.stateData = { targetChatId, replyText };
    await this.userRepository.save(user);
    await ctx.reply('Теперь отправьте голосовое сообщение для ответа');
  }

  async handleReplyVoice(
    ctx: Context,
    user: User,
    fileId: string,
    replyTextOverride?: string,
  ) {
    const targetChatId = user.stateData?.targetChatId;
    const replyText =
      replyTextOverride ??
      (user.stateData && (user.stateData as any).replyText) ??
      '';

    try {
      if (!targetChatId) {
        await ctx.reply('Ошибка: не найден получатель для ответа.');
        return;
      }

      const replyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Ответить', 'user_reply_to_admin')],
      ]);

      await ctx.telegram.sendVoice(targetChatId, fileId, {
        caption:
          '📩 Ответ от поддержки:\n' +
          (replyText && replyText.trim().length > 0
            ? replyText
            : '[без текста]'),
        ...replyKeyboard,
      });

      const request = await this.supportRequestRepository.findOne({
        where: { userId: targetChatId },
        order: { createdAt: 'DESC' },
      });

      if (request) {
        request.messages.push({
          message:
            replyText && replyText.trim().length > 0
              ? replyText
              : '[ГОЛОСОВОЕ]',
          createdAt: new Date().toISOString(),
          isAdmin: true,
          mediaType: 'voice',
          fileId,
        });
        request.status = 'answered';
        request.lastMessageAt = new Date();
        await this.supportRequestRepository.save(request);
      }

      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply('Ответ с голосовым сообщением отправлен!');
    } catch (e: any) {
      this.logger.error(
        `Failed to send support voice reply to ${targetChatId}`,
        e,
      );

      const targetUser =
        (await this.userRepository.findOne({
          where: { chatId: targetChatId },
        })) || null;

      const isBlockedError =
        e.response?.error_code === 403 ||
        e.message?.includes('bot was blocked');

      if (targetUser && isBlockedError) {
        if (!targetUser.isBlocked) {
          targetUser.isBlocked = true;
          await this.userRepository.save(targetUser);
        }

        await ctx.reply(
          '⚠️ Ответ не доставлен: пользователь заблокировал бота или отключил переписку.',
        );
      } else {
        await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
      }
    }
  }

  async handleReplyVideoNoteCommand(
    ctx: Context,
    user: User,
    targetChatId: string,
  ): Promise<void> {
    user.state = 'ADMIN_REPLY_VIDEO_NOTE';
    user.stateData = { targetChatId };
    await this.userRepository.save(user);
    await ctx.reply('Теперь отправьте видео-кружок для ответа');
  }

  async handleReplyVideoNote(ctx: Context, user: User, fileId: string) {
    const targetChatId = user.stateData?.targetChatId;

    try {
      if (!targetChatId) {
        await ctx.reply('Ошибка: не найден получатель для ответа.');
        return;
      }

      const replyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Ответить', 'user_reply_to_admin')],
      ]);

      await ctx.telegram.sendVideoNote(targetChatId, fileId, replyKeyboard);

      const request = await this.supportRequestRepository.findOne({
        where: { userId: targetChatId },
        order: { createdAt: 'DESC' },
      });

      if (request) {
        request.messages.push({
          message: '[ВИДЕО-КРУЖОК]',
          createdAt: new Date().toISOString(),
          isAdmin: true,
          mediaType: 'video_note',
          fileId,
        });
        request.status = 'answered';
        request.lastMessageAt = new Date();
        await this.supportRequestRepository.save(request);
      }

      user.state = null;
      user.stateData = null;
      await this.userRepository.save(user);
      await ctx.reply('Ответ с видео-кружком отправлен!');
    } catch (e: any) {
      this.logger.error(
        `Failed to send support video note reply to ${targetChatId}`,
        e,
      );

      const targetUser =
        (await this.userRepository.findOne({
          where: { chatId: targetChatId },
        })) || null;

      const isBlockedError =
        e.response?.error_code === 403 ||
        e.message?.includes('bot was blocked');

      if (targetUser && isBlockedError) {
        if (!targetUser.isBlocked) {
          targetUser.isBlocked = true;
          await this.userRepository.save(targetUser);
        }

        await ctx.reply(
          '⚠️ Ответ не доставлен: пользователь заблокировал бота или отключил переписку.',
        );
      } else {
        await ctx.reply('Ошибка при отправке ответа. Проверьте chat_id.');
      }
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
