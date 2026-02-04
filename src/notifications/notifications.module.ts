import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { NotificationsService } from './notifications.service';
import { Subscription } from '../database/entities/subscription.entity';
import { BotEvent } from '../database/entities/bot-event.entity';
import { ScheduleModule } from '../schedule/schedule.module';
import { ExamNotificationsService } from './exam-notifications.service';
import { Exam } from '../database/entities/exam.entity';
import { GradeNotificationsService } from './grade-notifications.service';
import { User } from '../database/entities/user.entity';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SemesterStartBroadcastService } from './semester-start-broadcast.service';
import { StatisticsService } from '../telegram-bot/services/statistics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Exam, User, BotEvent]),
    ScheduleModule,
    AnalyticsModule,
    HttpModule,
  ],
  providers: [
    NotificationsService,
    ExamNotificationsService,
    GradeNotificationsService,
    SemesterStartBroadcastService,
    StatisticsService,
  ],
})
export class NotificationsModule {}
