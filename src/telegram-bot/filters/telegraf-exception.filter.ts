import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { TelegrafArgumentsHost } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Catch()
export class TelegrafExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TelegrafExceptionFilter.name);

  async catch(exception: Error, host: ArgumentsHost): Promise<void> {
    const telegrafHost = TelegrafArgumentsHost.create(host);
    const ctx = telegrafHost.getContext<Context>();

    const updateType = ctx?.updateType;
    const update = (ctx?.update || {}) as any;

    let userContext = 'Unknown User';
    if (ctx?.from) {
      userContext = `${ctx.from.first_name}${
        ctx.from.last_name ? ' ' + ctx.from.last_name : ''
      } (@${ctx.from.username || 'no_user'}, id: ${ctx.from.id})`;
    }

    let messageContext = '';
    if (update.message) {
      messageContext = `\nMessage: ${update.message.text || '[non-text message]'}`;
    } else if (update.callback_query) {
      messageContext = `\nCallback Query Data: ${update.callback_query.data}`;
    }

    const errorDescription =
      (exception as any).description || exception.message;

    this.logger.error(
      `Telegraf error in ${updateType} update for ${userContext}: ${errorDescription}${messageContext}\nFull Error: ${exception.stack}`,
    );

    if (
      ctx.chat?.type === 'private' &&
      errorDescription.includes("can't parse entities")
    ) {
      try {
        await ctx.reply(
          '❌ Ой! Произошла ошибка при форматировании сообщения. Мы уже знаем об этом и скоро исправим.',
        );
      } catch (e) {}
    }
  }
}
