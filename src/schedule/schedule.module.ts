import { Module } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
