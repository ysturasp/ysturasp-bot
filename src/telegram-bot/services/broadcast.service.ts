import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import type { MessageEntity } from 'telegraf/types';
import { User } from '../../database/entities/user.entity';

const BROADCAST_PREFIX = '📢 Объявление:\n';

function shiftEntities(
  entities: MessageEntity[],
  offsetShift: number,
): MessageEntity[] {
  return entities.map((e) => ({ ...e, offset: e.offset + offsetShift }));
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async handleBroadcastCommand(
    ctx: Context,
    text: string,
    entities?: MessageEntity[],
  ) {
    await this.broadcastToAllUsers(text, ctx, entities);
  }

  async handleBroadcastPhoto(
    ctx: Context,
    fileId: string,
    caption: string,
    captionEntities?: MessageEntity[],
  ) {
    await this.broadcastPhotoToAllUsers(fileId, caption, ctx, captionEntities);
  }

  async handleBroadcastVideo(
    ctx: Context,
    fileId: string,
    caption: string,
    captionEntities?: MessageEntity[],
  ) {
    await this.broadcastVideoToAllUsers(fileId, caption, ctx, captionEntities);
  }

  private async broadcastToAllUsers(
    text: string,
    ctx: Context,
    entities?: MessageEntity[],
  ) {
    const users = await this.userRepository.find();
    let success = 0;
    let failed = 0;
    const blocked: string[] = [];
    const fullText = BROADCAST_PREFIX + text;
    const sendOptions = entities?.length
      ? { entities: shiftEntities(entities, BROADCAST_PREFIX.length) }
      : { parse_mode: 'HTML' as const };

    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user.chatId, fullText, sendOptions);
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
    captionEntities?: MessageEntity[],
  ) {
    const users = await this.userRepository.find();
    let success = 0;
    let failed = 0;
    const blocked: string[] = [];
    const fullCaption = BROADCAST_PREFIX + caption;
    const captionOptions = captionEntities?.length
      ? {
          caption_entities: shiftEntities(
            captionEntities,
            BROADCAST_PREFIX.length,
          ),
        }
      : { parse_mode: 'HTML' as const };

    for (const user of users) {
      try {
        await ctx.telegram.sendPhoto(user.chatId, fileId, {
          caption: fullCaption,
          ...captionOptions,
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
    captionEntities?: MessageEntity[],
  ) {
    const users = await this.userRepository.find();
    let success = 0;
    let failed = 0;
    const blocked: string[] = [];
    const fullCaption = BROADCAST_PREFIX + caption;
    const captionOptions = captionEntities?.length
      ? {
          caption_entities: shiftEntities(
            captionEntities,
            BROADCAST_PREFIX.length,
          ),
        }
      : { parse_mode: 'HTML' as const };

    for (const user of users) {
      try {
        await ctx.telegram.sendVideo(user.chatId, fileId, {
          caption: fullCaption,
          ...captionOptions,
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
