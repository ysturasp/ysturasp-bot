import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

@Controller()
export class HealthController {
  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    @InjectBot() private readonly bot: Telegraf,
  ) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health/redis')
  async getRedisHealth() {
    try {
      const ping = await this.redis.ping();
      if (ping !== 'PONG') {
        throw new ServiceUnavailableException('Redis ping failed');
      }
      return {
        status: 'ok',
        ping,
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      throw new ServiceUnavailableException('Redis unavailable');
    }
  }

  @Get('health/bot')
  async getBotHealth() {
    try {
      const me = await this.bot.telegram.getMe();
      return {
        status: 'ok',
        bot: {
          id: me.id,
          username: me.username,
          first_name: me.first_name,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      throw new ServiceUnavailableException('Bot unavailable');
    }
  }
}
