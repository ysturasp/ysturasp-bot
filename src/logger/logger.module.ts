import { Module } from '@nestjs/common';
import { RedisLogger } from './redis-logger.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [RedisLogger],
  exports: [RedisLogger],
})
export class LoggerModule {}
