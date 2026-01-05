import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { Referral } from '../../database/entities/referral.entity';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Referral)
    private readonly referralRepository: Repository<Referral>,
  ) {}

  async createReferralByUserId(
    referrerUserId: string,
    referredUserId: string,
  ): Promise<Referral | null> {
    if (referrerUserId === referredUserId) {
      return null;
    }

    const existing = await this.referralRepository.findOne({
      where: { referredId: referredUserId },
    });

    if (existing) {
      return null;
    }

    const referrer = await this.userRepository.findOne({
      where: { id: referrerUserId },
    });
    const referred = await this.userRepository.findOne({
      where: { id: referredUserId },
    });

    if (!referrer || !referred) {
      return null;
    }

    try {
      const referral = this.referralRepository.create({
        referrerId: referrerUserId,
        referredId: referredUserId,
      });
      const savedReferral = await this.referralRepository.save(referral);

      await this.updateReferralBonuses(referrerUserId, referredUserId);

      return savedReferral;
    } catch (error: any) {
      this.logger.error('Error creating referral', error);
      if (error?.code === '23505' || error?.code === '23503') {
        return null;
      }
      throw error;
    }
  }

  private async updateReferralBonuses(
    referrerId: string,
    referredId: string,
  ): Promise<void> {
    const queryRunner =
      this.referralRepository.manager.connection.createQueryRunner();

    try {
      await queryRunner.connect();

      const tableExists = await queryRunner.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'stat_limits'
        )
      `);

      if (!tableExists[0]?.exists) {
        this.logger.debug(
          'Table stat_limits does not exist, skipping bonus update',
        );
        return;
      }

      const referralCount = await this.referralRepository.count({
        where: { referrerId },
      });
      const bonusLimit = 10 + referralCount * 10;

      await queryRunner.query(
        `INSERT INTO stat_limits (user_id, monthly_limit, referral_bonus, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) 
         DO UPDATE SET monthly_limit = $2, referral_bonus = $3, updated_at = NOW()`,
        [referrerId, bonusLimit, referralCount],
      );

      const referredBonus = 5;
      const referredLimitResult = await queryRunner.query(
        'SELECT monthly_limit FROM stat_limits WHERE user_id = $1',
        [referredId],
      );

      if (referredLimitResult.length > 0) {
        const currentLimit = referredLimitResult[0].monthly_limit || 10;
        const newLimit = currentLimit + referredBonus;
        await queryRunner.query(
          `UPDATE stat_limits 
           SET monthly_limit = $1, updated_at = NOW()
           WHERE user_id = $2`,
          [newLimit, referredId],
        );
      } else {
        const newLimit = 10 + referredBonus;
        await queryRunner.query(
          `INSERT INTO stat_limits (user_id, monthly_limit, referral_bonus)
           VALUES ($1, $2, $3)`,
          [referredId, newLimit, 0],
        );
      }
    } catch (error) {
      this.logger.error('Error updating referral bonuses', error);
    } finally {
      await queryRunner.release();
    }
  }

  async hasReferral(referredUserId: string): Promise<boolean> {
    const referral = await this.referralRepository.findOne({
      where: { referredId: referredUserId },
    });
    return !!referral;
  }
}
