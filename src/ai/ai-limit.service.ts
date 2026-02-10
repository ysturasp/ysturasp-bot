import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { UserAiUsage } from '../database/entities/user-ai-usage.entity';

@Injectable()
export class AiLimitService {
  private readonly FREE_MONTHLY_LIMIT = 50;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserAiUsage)
    private readonly usageRepository: Repository<UserAiUsage>,
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

  async checkAndResetLimits(user: User): Promise<void> {
    const now = new Date();
    const usage = await this.getOrCreateUsage(user);

    let updated = false;

    const lastResetMonthly = usage.lastResetMonthly || now;
    if (
      now.getMonth() !== lastResetMonthly.getMonth() ||
      now.getFullYear() !== lastResetMonthly.getFullYear()
    ) {
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

  async canRequest(user: User): Promise<boolean> {
    if (user.isAdmin) return true;
    await this.checkAndResetLimits(user);
    const usage = await this.getOrCreateUsage(user);
    return usage.monthlyCount < this.FREE_MONTHLY_LIMIT;
  }

  async incrementUsage(user: User): Promise<void> {
    const usage = await this.getOrCreateUsage(user);
    usage.monthlyCount++;
    usage.weeklyCount++;
    await this.usageRepository.save(usage);
  }

  async getRemainingRequests(user: User): Promise<number> {
    const usage = await this.getOrCreateUsage(user);
    return Math.max(0, this.FREE_MONTHLY_LIMIT - usage.monthlyCount);
  }

  async getNextResetDate(user: User): Promise<Date> {
    const usage = await this.getOrCreateUsage(user);
    const nextMonth = new Date(usage.lastResetMonthly || new Date());
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);
    return nextMonth;
  }
}
