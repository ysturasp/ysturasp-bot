import { ConsoleLogger, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisLogger extends ConsoleLogger {
  constructor(@Inject('REDIS') private readonly redis: Redis) {
    super();
  }

  private async saveLog(
    level: string,
    message: any,
    context?: string,
    stack?: string,
  ) {
    const skipContexts = [
      'NestFactory',
      'InstanceLoader',
      'RoutesResolver',
      'RouterExplorer',
      'NestApplication',
    ];

    const contextToCheck = context || this.context;
    if (contextToCheck && skipContexts.includes(contextToCheck)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({
      timestamp,
      level,
      context: contextToCheck,
      message,
      stack,
    });

    try {
      const pipeline = this.redis.pipeline();
      pipeline.lpush('app:logs', logEntry);
      pipeline.ltrim('app:logs', 0, 1999);
      await pipeline.exec();
    } catch (e) {
      console.error('Failed to write log to Redis', e);
    }
  }

  log(message: any, context?: string) {
    super.log(message, context);
    this.saveLog('log', message, context);
  }

  error(message: any, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.saveLog('error', message, context, stack);
  }

  warn(message: any, context?: string) {
    super.warn(message, context);
    this.saveLog('warn', message, context);
  }

  debug(message: any, context?: string) {
    super.debug(message, context);
    this.saveLog('debug', message, context);
  }

  verbose(message: any, context?: string) {
    super.verbose(message, context);
    this.saveLog('verbose', message, context);
  }
}
