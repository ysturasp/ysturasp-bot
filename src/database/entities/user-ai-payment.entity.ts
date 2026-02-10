import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export type AiPaymentStatus = 'succeeded' | 'refunded' | 'refund_failed';

@Entity('user_ai_payments')
export class UserAiPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index('idx_user_ai_payment_user_id')
  user: User;

  @Column({ type: 'varchar' })
  payload: string;

  @Column({ type: 'integer' })
  amountKops: number;

  @Column({ type: 'varchar' })
  currency: string;

  @Column({ nullable: true })
  telegramPaymentChargeId: string | null;

  @Column({ nullable: true })
  providerPaymentChargeId: string | null;

  @Column({ nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'integer', default: 0 })
  usageMonthlyCountAtPurchase: number;

  @Column({ type: 'integer', default: 0 })
  usageWeeklyCountAtPurchase: number;

  @Column({ type: 'varchar', default: 'succeeded' })
  status: AiPaymentStatus;

  @Column({ type: 'timestamp', nullable: true })
  refundedAt: Date | null;

  @Column({ nullable: true })
  refundId: string | null;

  @Column({ type: 'text', nullable: true })
  refundError: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
