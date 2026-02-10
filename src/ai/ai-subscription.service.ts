import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { UserAiSubscription } from '../database/entities/user-ai-subscription.entity';

@Injectable()
export class AiSubscriptionService {
  static readonly PLUS_MONTHLY_LIMIT = 200;
  static readonly FREE_MONTHLY_LIMIT = 50;

  constructor(
    @InjectRepository(UserAiSubscription)
    private readonly subscriptionRepository: Repository<UserAiSubscription>,
  ) {}

  async hasActivePlus(user: User): Promise<boolean> {
    const sub = await this.getActiveSubscription(user);
    return !!sub;
  }

  async getActiveSubscription(user: User): Promise<UserAiSubscription | null> {
    const now = new Date();
    const sub = await this.subscriptionRepository.findOne({
      where: {
        user: { id: user.id },
        plan: 'plus',
        status: 'active',
        expiresAt: MoreThan(now),
      },
      order: { expiresAt: 'DESC' },
      relations: ['user'],
    });
    return sub ?? null;
  }

  async getMonthlyLimit(user: User): Promise<number> {
    const hasPlus = await this.hasActivePlus(user);
    return hasPlus
      ? AiSubscriptionService.PLUS_MONTHLY_LIMIT
      : AiSubscriptionService.FREE_MONTHLY_LIMIT;
  }

  async activatePlus(
    user: User,
    providerPaymentChargeId: string,
  ): Promise<{
    subscription: UserAiSubscription;
    wasExtended: boolean;
    previousExpiresAt: Date | null;
  }> {
    const now = new Date();
    const current = await this.getActiveSubscription(user);
    const previousExpiresAt = current ? new Date(current.expiresAt) : null;
    const startFrom = current ? new Date(current.expiresAt) : now;
    const expiresAt = new Date(startFrom);
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    const sub = this.subscriptionRepository.create({
      user,
      plan: 'plus',
      expiresAt,
      status: 'active',
      providerPaymentChargeId,
    });
    const subscription = await this.subscriptionRepository.save(sub);
    return {
      subscription,
      wasExtended: !!current,
      previousExpiresAt,
    };
  }

  async markSubscriptionRefunded(subscriptionId: string): Promise<void> {
    await this.subscriptionRepository.update(subscriptionId, {
      status: 'refunded',
    });
  }
}
