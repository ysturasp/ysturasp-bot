import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleModule } from '../schedule/schedule.module';
import { ExamNotificationsService } from './exam-notifications.service';
import { Exam } from '../database/entities/exam.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, Exam]), ScheduleModule],
  providers: [NotificationsService, ExamNotificationsService],
})
export class NotificationsModule {}
