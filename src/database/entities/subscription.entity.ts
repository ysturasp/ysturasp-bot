import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column()
  groupName: string;

  @Column({ default: 30 })
  notifyMinutes: number;

  @Column({ default: true })
  isActive: boolean;

  @Column('jsonb', { default: [] })
  hiddenSubjects: string[];

  @Column({ default: false })
  excludeHidden: boolean;

  @Column('jsonb', { default: [] })
  manuallyExcludedSubjects: string[];
}
