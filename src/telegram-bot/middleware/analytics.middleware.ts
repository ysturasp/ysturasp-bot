import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { AnalyticsService } from '../../analytics/analytics.service';
import { UserHelperService } from '../services/user-helper.service';

type UpdateLike = {
  message?: {
    chat?: { id: number };
    text?: string;
    photo?: unknown;
    video?: unknown;
    document?: unknown;
    voice?: unknown;
    sticker?: unknown;
  };
  callback_query?: {
    message?: { chat?: { id: number } };
    from?: { id: number };
    data?: string;
  };
  pre_checkout_query?: { from?: { id: number } };
  shipping_query?: { from?: { id: number } };
};

function getChatId(ctx: Context): string | null {
  const u = ctx.update as UpdateLike;
  if (u.message?.chat) {
    return String(u.message.chat.id);
  }
  if (u.callback_query) {
    const msg = u.callback_query.message;
    if (msg && 'chat' in msg && msg.chat) return String(msg.chat.id);
    if (u.callback_query.from?.id) return String(u.callback_query.from.id);
  }
  if (u.pre_checkout_query?.from?.id) {
    return String(u.pre_checkout_query.from.id);
  }
  if (u.shipping_query?.from?.id) {
    return String(u.shipping_query.from.id);
  }
  return null;
}

function getEventType(ctx: Context): string | null {
  const u = ctx.update as UpdateLike;
  if (u.message) {
    const msg = u.message as {
      text?: string;
      photo?: unknown;
      video?: unknown;
      document?: unknown;
      voice?: unknown;
      sticker?: unknown;
    };
    if (msg.text) {
      const t = msg.text.trim();
      if (t.startsWith('/')) {
        const cmd = t.split(/\s/)[0].slice(1).toLowerCase();
        return `command:${cmd}`;
      }
      return 'text';
    }
    if (msg.photo) return 'photo';
    if (msg.video) return 'video';
    if (msg.document) return 'document';
    if (msg.voice) return 'voice';
    if (msg.sticker) return 'sticker';
    return 'message';
  }
  if (u.callback_query) {
    const data = u.callback_query.data;
    if (typeof data === 'string') {
      const action = data.split(':')[0] || data.slice(0, 64);
      return `action:${action}`;
    }
    return 'callback_query';
  }
  if (u.pre_checkout_query) return 'pre_checkout_query';
  if (u.shipping_query) return 'shipping_query';
  return null;
}

function getPayload(ctx: Context): Record<string, unknown> | null {
  const u = ctx.update as UpdateLike;
  if (u.callback_query) {
    const data = u.callback_query.data;
    if (typeof data === 'string')
      return { callback_data: data.length > 200 ? data.slice(0, 200) : data };
  }
  if (u.message && 'text' in u.message) {
    const text = String((u.message as { text?: string }).text || '').trim();
    if (text.startsWith('/')) {
      const parts = text.split(/\s/);
      return { command: parts[0], args_length: parts.length - 1 };
    }
    return { text_length: text.length };
  }
  return null;
}

@Injectable()
export class AnalyticsMiddleware {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly userHelper: UserHelperService,
  ) {}

  async use(ctx: Context, next: () => Promise<void>): Promise<void> {
    const chatId = getChatId(ctx);
    const eventType = getEventType(ctx);

    if (!chatId || !eventType) {
      return next();
    }

    let userId: string | null = null;
    try {
      const user = await this.userHelper.getUser(ctx);
      userId = user.id;
    } catch {}

    this.analytics
      .track({
        chatId,
        userId,
        eventType,
        payload: getPayload(ctx),
        source: 'telegram',
      })
      .catch(() => {});

    return next();
  }
}
