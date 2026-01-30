import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { AnalyticsMiddleware } from './analytics.middleware';

@Injectable()
export class AnalyticsLauncherService implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly analyticsMiddleware: AnalyticsMiddleware,
  ) {}

  onModuleInit(): void {
    this.bot.use((ctx, next) => this.analyticsMiddleware.use(ctx, next));
  }
}
