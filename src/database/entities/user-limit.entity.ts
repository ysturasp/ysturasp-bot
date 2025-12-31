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

@Entity('user_limits')
@Unique(['userId'])
export class UserLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @Column({ name: 'free_formats_used', default: 0 })
  freeFormatsUsed: number;

  @Column({ name: 'paid_formats_used', default: 0 })
  paidFormatsUsed: number;

  @Column({ name: 'paid_formats_purchased', default: 0 })
  paidFormatsPurchased: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
