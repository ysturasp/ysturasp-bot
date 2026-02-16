import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TelegramBotService } from './telegram-bot.service';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleModule } from '../schedule/schedule.module';
import { Exam } from '../database/entities/exam.entity';
import { Poll } from '../database/entities/poll.entity';
import { PollAnswer } from '../database/entities/poll-answer.entity';
import { SupportRequest } from '../database/entities/support-request.entity';
import { SupportService } from './services/support.service';
import { PollService } from './services/poll.service';
import { BroadcastService } from './services/broadcast.service';
import { NotificationTestService } from './services/notification-test.service';
import { SubscriptionService } from './services/subscription.service';
import { ScheduleCommandService } from './services/schedule-command.service';
import { UserHelperService } from './services/user-helper.service';
import { TextHandlerService } from './services/text-handler.service';
import { EncryptionService } from './services/encryption.service';
import { TelegramWebappController } from './telegram-webapp.controller';
import { YearEndBroadcastService } from './services/year-end-broadcast.service';
import { Referral } from '../database/entities/referral.entity';
import { ReferralService } from './services/referral.service';
import { StatisticsService } from './services/statistics.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AnalyticsMiddleware } from './middleware/analytics.middleware';
import { AnalyticsLauncherService } from './middleware/analytics-launcher.service';
import { AiModule } from '../ai/ai.module';
import { UserAiContext } from '../database/entities/user-ai-context.entity';
import { UserAiPayment } from '../database/entities/user-ai-payment.entity';
import { TelegrafExceptionFilter } from './filters/telegraf-exception.filter';
import { APP_FILTER } from '@nestjs/core';

@Module({
  imports: [
    AnalyticsModule,
    TypeOrmModule.forFeature([
      User,
      Subscription,
      Exam,
      Poll,
      PollAnswer,
      SupportRequest,
      Referral,
      UserAiContext,
      UserAiPayment,
    ]),
    ScheduleModule,
    HttpModule,
    AiModule,
  ],
  controllers: [TelegramWebappController],
  providers: [
    TelegramBotService,
    SupportService,
    PollService,
    BroadcastService,
    NotificationTestService,
    SubscriptionService,
    ScheduleCommandService,
    UserHelperService,
    TextHandlerService,
    EncryptionService,
    YearEndBroadcastService,
    ReferralService,
    StatisticsService,
    AnalyticsMiddleware,
    AnalyticsLauncherService,
    {
      provide: APP_FILTER,
      useClass: TelegrafExceptionFilter,
    },
  ],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
