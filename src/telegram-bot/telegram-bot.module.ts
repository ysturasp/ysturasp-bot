import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Subscription,
      Exam,
      Poll,
      PollAnswer,
      SupportRequest,
    ]),
    ScheduleModule,
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
  ],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
