import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { Subscription } from '../database/entities/subscription.entity';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription]), ScheduleModule],
  providers: [NotificationsService],
})
export class NotificationsModule {}
