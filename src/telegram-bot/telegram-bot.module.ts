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
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
