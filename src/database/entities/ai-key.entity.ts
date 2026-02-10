import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ai_keys')
export class AiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column({ default: 'groq' })
  provider: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'integer', default: 0 })
  remainingRequests: number;

  @Column({ type: 'integer', default: 0 })
  remainingTokens: number;

  @Column({ type: 'timestamp', nullable: true })
  resetRequestsAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resetTokensAt: Date;

  @Column({ type: 'bigint', default: 0 })
  totalTokens: number;

  @Column({ type: 'integer', default: 0 })
  totalRequests: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
