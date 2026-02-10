import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_ai_usage')
export class UserAiUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'integer', default: 0 })
  monthlyCount: number;

  @Column({ type: 'integer', default: 0 })
  weeklyCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastResetMonthly: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastResetWeekly: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

