import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { UserAiUsage } from '../database/entities/user-ai-usage.entity';
import { AiSubscriptionService } from './ai-subscription.service';

@Injectable()
export class AiLimitService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserAiUsage)
    private readonly usageRepository: Repository<UserAiUsage>,
    private readonly aiSubscriptionService: AiSubscriptionService,
  ) {}

  private async getOrCreateUsage(user: User): Promise<UserAiUsage> {
    let usage = await this.usageRepository.findOne({
      where: { user: { id: user.id } },
      relations: ['user'],
    });

    if (!usage) {
      const now = new Date();
      usage = this.usageRepository.create({
        user,
        monthlyCount: 0,
        weeklyCount: 0,
        lastResetMonthly: now,
        lastResetWeekly: now,
      });
      usage = await this.usageRepository.save(usage);
    }

    return usage;
  }

  async getUsageSnapshot(user: User): Promise<{
    monthlyCount: number;
    weeklyCount: number;
  }> {
    const usage = await this.getOrCreateUsage(user);
    return { monthlyCount: usage.monthlyCount, weeklyCount: usage.weeklyCount };
  }

  async checkAndResetLimits(user: User): Promise<void> {
    const now = new Date();
    const usage = await this.getOrCreateUsage(user);

    let updated = false;

    const lastResetMonthly = usage.lastResetMonthly || now;
    const msPerMonth = 30 * 24 * 60 * 60 * 1000;
    if (now.getTime() - lastResetMonthly.getTime() > msPerMonth) {
      usage.monthlyCount = 0;
      usage.lastResetMonthly = now;
      updated = true;
    }

    const lastResetWeekly = usage.lastResetWeekly || now;
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    if (now.getTime() - lastResetWeekly.getTime() > msPerWeek) {
      usage.weeklyCount = 0;
      usage.lastResetWeekly = now;
      updated = true;
    }

    if (updated) {
      await this.usageRepository.save(usage);
    }
  }

  async getMonthlyLimit(user: User): Promise<number> {
    return this.aiSubscriptionService.getMonthlyLimit(user);
  }

  async canRequest(user: User): Promise<boolean> {
    if (user.isAdmin) return true;
    await this.checkAndResetLimits(user);
    const usage = await this.getOrCreateUsage(user);
    const limit = await this.getMonthlyLimit(user);
    return usage.monthlyCount < limit;
  }

  async incrementUsage(user: User): Promise<void> {
    const usage = await this.getOrCreateUsage(user);
    usage.monthlyCount++;
    usage.weeklyCount++;
    await this.usageRepository.save(usage);
  }

  async getRemainingRequests(user: User): Promise<number> {
    const usage = await this.getOrCreateUsage(user);
    const limit = await this.getMonthlyLimit(user);
    return Math.max(0, limit - usage.monthlyCount);
  }

  async getNextResetDate(user: User): Promise<Date> {
    const usage = await this.getOrCreateUsage(user);
    const base = usage.lastResetMonthly || new Date();
    const msPerMonth = 30 * 24 * 60 * 60 * 1000;
    const next = new Date(base.getTime() + msPerMonth);
    next.setHours(0, 0, 0, 0);
    return next;
  }
}
