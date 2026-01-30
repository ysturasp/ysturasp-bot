import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export type BotEventSource = 'telegram' | 'webapp';

@Entity('bot_events')
export class BotEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'chat_id', type: 'varchar', length: 64 })
  @Index()
  chatId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  @Index()
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  @Index()
  eventType: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32, default: 'telegram' })
  source: BotEventSource;

  @CreateDateColumn({ name: 'created_at' })
  @Index()
  createdAt: Date;
}
