import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from '../database/entities/user.entity';
import { AiKey } from '../database/entities/ai-key.entity';
import { UserAiUsage } from '../database/entities/user-ai-usage.entity';
import { UserAiSubscription } from '../database/entities/user-ai-subscription.entity';
import { GroqService } from './groq.service';
import { AiLimitService } from './ai-limit.service';
import { AiSubscriptionService } from './ai-subscription.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AiKey, UserAiUsage, UserAiSubscription]),
    ConfigModule,
  ],
  providers: [GroqService, AiLimitService, AiSubscriptionService],
  exports: [GroqService, AiLimitService, AiSubscriptionService],
})
export class AiModule {}
