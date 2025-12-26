import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { User } from '../../database/entities/user.entity';
import { SupportRequest } from '../../database/entities/support-request.entity';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportRequest)
    private readonly supportRequestRepository: Repository<SupportRequest>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async handleSupportCommand(ctx: Context, user: User): Promise<void> {
    user.state = 'SUPPORT';
    await ctx.reply(
      'Пожалуйста, введите ваш запрос в следующем сообщении (допускается одна фотография)',
    );
  }

  async handleSuggestionCommand(ctx: Context, user: User): Promise<void> {
    user.state = 'SUGGESTION';
    await ctx.reply(
      'Пожалуйста, введите ваше предложение в следующем сообщении (допускается одна фотография)',
    );
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

    user.state = null;
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

    user.state = null;
    await this.userRepository.save(user);
    await ctx.reply('Ваша фотография и текст отправлены в поддержку. Спасибо!');
  }

  async handleReplyCommand(
    ctx: Context,
    targetChatId: string,
    replyText: string,
  ) {
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
  }
}
