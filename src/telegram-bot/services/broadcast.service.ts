import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import type { MessageEntity } from 'telegraf/types';
import { User } from '../../database/entities/user.entity';

const BROADCAST_PREFIX = '📢 Объявление:\n';

export const BROADCAST_EXCLUDE_PREFIX = /^!except\s+|^!exclude\s+/i;

function shiftEntities(
  entities: MessageEntity[],
  offsetShift: number,
): MessageEntity[] {
  return entities.map((e) => ({ ...e, offset: e.offset + offsetShift }));
}

export function parseBroadcastExclude(rawText: string): {
  excludeIdentifiers: string[];
  text: string;
  entityOffsetShift: number;
} {
  const trimmed = rawText.trim();
  const match = trimmed.match(BROADCAST_EXCLUDE_PREFIX);
  if (!match) {
    return { excludeIdentifiers: [], text: trimmed, entityOffsetShift: 0 };
  }
  const firstLineEnd = trimmed.indexOf('\n');
  const firstLine =
    firstLineEnd >= 0 ? trimmed.slice(0, firstLineEnd) : trimmed;
  const rest = firstLineEnd >= 0 ? trimmed.slice(firstLineEnd + 1).trim() : '';
  const excludePart = firstLine.replace(BROADCAST_EXCLUDE_PREFIX, '').trim();
  const excludeIdentifiers = excludePart
    ? excludePart.split(/[,;\s]+/).map((s) => s.replace(/^@/, '').trim())
    : [];
  const entityOffsetShift =
    firstLineEnd >= 0 ? firstLineEnd + 1 : firstLine.length;
  return {
    excludeIdentifiers: excludeIdentifiers.filter(Boolean),
    text: rest,
    entityOffsetShift,
  };
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async resolveExcludeIdentifiers(identifiers: string[]): Promise<string[]> {
    if (identifiers.length === 0) return [];
    const chatIds: string[] = [];
    for (const id of identifiers) {
      const isNumeric = /^\d+$/.test(id);
      if (isNumeric) {
        chatIds.push(id);
      } else {
        const user = await this.userRepository.findOne({
          where: { username: id },
        });
        if (user) chatIds.push(user.chatId);
      }
    }
    return [...new Set(chatIds)];
  }

  async handleBroadcastCommand(
    ctx: Context,
    text: string,
    entities?: MessageEntity[],
    excludeChatIds?: string[],
  ) {
    const resolved = excludeChatIds?.length
      ? await this.resolveExcludeIdentifiers(excludeChatIds)
      : [];
    await this.broadcastToAllUsers(text, ctx, entities, resolved);
  }

  async handleBroadcastPhoto(
    ctx: Context,
    fileId: string,
    caption: string,
    captionEntities?: MessageEntity[],
    excludeChatIds?: string[],
  ) {
    const resolved = excludeChatIds?.length
      ? await this.resolveExcludeIdentifiers(excludeChatIds)
      : [];
    await this.broadcastPhotoToAllUsers(
      fileId,
      caption,
      ctx,
      captionEntities,
      resolved,
    );
  }

  async handleBroadcastVideo(
    ctx: Context,
    fileId: string,
    caption: string,
    captionEntities?: MessageEntity[],
    excludeChatIds?: string[],
  ) {
    const resolved = excludeChatIds?.length
      ? await this.resolveExcludeIdentifiers(excludeChatIds)
      : [];
    await this.broadcastVideoToAllUsers(
      fileId,
      caption,
      ctx,
      captionEntities,
      resolved,
    );
  }

  private async broadcastToAllUsers(
    text: string,
    ctx: Context,
    entities?: MessageEntity[],
    excludeChatIds: string[] = [],
  ) {
    const users = await this.userRepository.find({
      where: { isBlocked: false },
    });
    const excludeSet = new Set(excludeChatIds);
    const filtered =
      excludeSet.size > 0
        ? users.filter((u) => !excludeSet.has(u.chatId))
        : users;
    let success = 0;
    let failed = 0;
    const blocked: string[] = [];
    const fullText = BROADCAST_PREFIX + text;
    const sendOptions = entities?.length
      ? { entities: shiftEntities(entities, BROADCAST_PREFIX.length) }
      : { parse_mode: 'HTML' as const };

    for (const user of filtered) {
      try {
        await ctx.telegram.sendMessage(user.chatId, fullText, sendOptions);
        success++;
      } catch (e: any) {
        failed++;
        if (
          e.response?.error_code === 403 ||
          e.message?.includes('bot was blocked')
        ) {
          blocked.push(user.username || user.chatId);
          if (!user.isBlocked) {
            user.isBlocked = true;
            await this.userRepository.save(user);
          }
        }
      }
    }

    const excludeInfo =
      excludeChatIds.length > 0
        ? ` Исключено: ${excludeChatIds.length} чел.`
        : '';
    await ctx.reply(
      `Сообщение отправлено ${success} пользователям.${excludeInfo}\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота:\n${blocked.join('\n')}` : ''}`,
    );
  }

  private async broadcastPhotoToAllUsers(
    fileId: string,
    caption: string,
    ctx: Context,
    captionEntities?: MessageEntity[],
    excludeChatIds: string[] = [],
  ) {
    const users = await this.userRepository.find({
      where: { isBlocked: false },
    });
    const excludeSet = new Set(excludeChatIds);
    const filtered =
      excludeSet.size > 0
        ? users.filter((u) => !excludeSet.has(u.chatId))
        : users;
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

    for (const user of filtered) {
      try {
        await ctx.telegram.sendPhoto(user.chatId, fileId, {
          caption: fullCaption,
          ...captionOptions,
        });
        success++;
      } catch (e: any) {
        failed++;
        if (
          e.response?.error_code === 403 ||
          e.message?.includes('bot was blocked')
        ) {
          blocked.push(user.username || user.chatId);
          if (!user.isBlocked) {
            user.isBlocked = true;
            await this.userRepository.save(user);
          }
        }
      }
    }

    const excludeInfo =
      excludeChatIds.length > 0
        ? ` Исключено: ${excludeChatIds.length} чел.`
        : '';
    await ctx.reply(
      `Фото отправлено ${success} пользователям.${excludeInfo}\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота:\n${blocked.join('\n')}` : ''}`,
    );
  }

  private async broadcastVideoToAllUsers(
    fileId: string,
    caption: string,
    ctx: Context,
    captionEntities?: MessageEntity[],
    excludeChatIds: string[] = [],
  ) {
    const users = await this.userRepository.find({
      where: { isBlocked: false },
    });
    const excludeSet = new Set(excludeChatIds);
    const filtered =
      excludeSet.size > 0
        ? users.filter((u) => !excludeSet.has(u.chatId))
        : users;
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

    for (const user of filtered) {
      try {
        await ctx.telegram.sendVideo(user.chatId, fileId, {
          caption: fullCaption,
          ...captionOptions,
        });
        success++;
      } catch (e: any) {
        failed++;
        if (
          e.response?.error_code === 403 ||
          e.message?.includes('bot was blocked')
        ) {
          blocked.push(user.username || user.chatId);
          if (!user.isBlocked) {
            user.isBlocked = true;
            await this.userRepository.save(user);
          }
        }
      }
    }

    const excludeInfo =
      excludeChatIds.length > 0
        ? ` Исключено: ${excludeChatIds.length} чел.`
        : '';
    await ctx.reply(
      `Видео отправлено ${success} пользователям.${excludeInfo}\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота:\n${blocked.join('\n')}` : ''}`,
    );
  }
}
