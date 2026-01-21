import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import { User } from '../../database/entities/user.entity';

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async handleBroadcastCommand(ctx: Context, text: string) {
    await this.broadcastToAllUsers(text, ctx);
  }

  async handleBroadcastPhoto(ctx: Context, fileId: string, caption: string) {
    await this.broadcastPhotoToAllUsers(fileId, caption, ctx);
  }

  async handleBroadcastVideo(ctx: Context, fileId: string, caption: string) {
    await this.broadcastVideoToAllUsers(fileId, caption, ctx);
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
      `Фото отправлено ${success} пользователям.\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота:\n${blocked.join('\n')}` : ''}`,
    );
  }

  private async broadcastVideoToAllUsers(
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
        await ctx.telegram.sendVideo(user.chatId, fileId, {
          caption: '📢 Объявление:\n' + caption,
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
      `Видео отправлено ${success} пользователям.\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота:\n${blocked.join('\n')}` : ''}`,
    );
  }
}
