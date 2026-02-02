import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotEvent } from '../database/entities/bot-event.entity';
import { AnalyticsService } from './analytics.service';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BotEvent, User, Subscription])],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
