import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('stat_limits')
@Unique(['userId'])
export class StatLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @Column({ name: 'monthly_limit', default: 10 })
  monthlyLimit: number;

  @Column({ name: 'referral_bonus', default: 0 })
  referralBonus: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
