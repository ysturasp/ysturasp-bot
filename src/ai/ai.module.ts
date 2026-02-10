import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from '../database/entities/user.entity';
import { AiKey } from '../database/entities/ai-key.entity';
import { UserAiUsage } from '../database/entities/user-ai-usage.entity';
import { GroqService } from './groq.service';
import { AiLimitService } from './ai-limit.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, AiKey, UserAiUsage]), ConfigModule],
  providers: [GroqService, AiLimitService],
  exports: [GroqService, AiLimitService],
})
export class AiModule {}
