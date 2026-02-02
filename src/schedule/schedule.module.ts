import { Module } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { ScheduleWarmupService } from './schedule-warmup.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [ScheduleService, ScheduleWarmupService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
