import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleModule } from '../schedule/schedule.module';
import { ExamNotificationsService } from './exam-notifications.service';
import { Exam } from '../database/entities/exam.entity';
import { GradeNotificationsService } from './grade-notifications.service';
import { User } from '../database/entities/user.entity';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Exam, User]),
    ScheduleModule,
    AnalyticsModule,
  ],
  providers: [
    NotificationsService,
    ExamNotificationsService,
    GradeNotificationsService,
  ],
})
export class NotificationsModule {}
