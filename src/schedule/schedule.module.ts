import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleService } from './schedule.service';
import { ScheduleWarmupService } from './schedule-warmup.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const timeoutSec = configService.get<number>(
          'SCHEDULE_API_TIMEOUT_SEC',
          10,
        );
        return {
          timeout: timeoutSec * 1000,
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [ScheduleService, ScheduleWarmupService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
