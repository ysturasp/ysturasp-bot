import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export type AiPlanType = 'plus';
export type AiSubscriptionStatus = 'active' | 'refunded';

@Entity('user_ai_subscriptions')
export class UserAiSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index('idx_user_ai_sub_user_id')
  user: User;

  @Column({ type: 'varchar', default: 'plus' })
  plan: AiPlanType;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'varchar', default: 'active' })
  status: AiSubscriptionStatus;

  @Column({ nullable: true })
  providerPaymentChargeId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
