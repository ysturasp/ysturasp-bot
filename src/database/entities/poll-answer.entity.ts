import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Poll } from './poll.entity';
import { User } from './user.entity';

@Entity('poll_answers')
export class PollAnswer {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Poll, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pollId' })
  poll: Poll;

  @Column()
  pollId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column()
  answer: string;

  @CreateDateColumn()
  answeredAt: Date;
}
