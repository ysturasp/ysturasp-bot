import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule as CronScheduleModule } from '@nestjs/schedule';
import { TelegrafModule } from 'nestjs-telegraf';
import { CacheModule } from '@nestjs/cache-manager';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User } from './database/entities/user.entity';
import { Subscription } from './database/entities/subscription.entity';
import { Poll } from './database/entities/poll.entity';
import { PollAnswer } from './database/entities/poll-answer.entity';
import { SupportRequest } from './database/entities/support-request.entity';
import { Exam } from './database/entities/exam.entity';
import { UserSession } from './database/entities/user-session.entity';
import { ScheduleModule } from './schedule/schedule.module';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: (configService: ConfigService) => {
        const ttl = configService.get<number>('CACHE_TTL', 1200);
        const password = configService.get<string>('REDIS_PASSWORD');
        return {
          store: require('cache-manager-ioredis'),
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          ...(password && { password }),
          ttl,
        } as any;
      },
      inject: [ConfigService],
    }),
    CronScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_DATABASE', 'postgres'),
        entities: [
          User,
          Subscription,
          Poll,
          PollAnswer,
          SupportRequest,
          Exam,
          UserSession,
        ],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('TELEGRAM_BOT_TOKEN'),
      }),
      inject: [ConfigService],
    }),
    TelegramBotModule,
    ScheduleModule,
    NotificationsModule,
    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
