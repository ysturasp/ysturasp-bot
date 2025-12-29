import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('support_requests')
export class SupportRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  userId: string;

  @Column('jsonb')
  messages: {
    message: string;
    createdAt: string;
    isAdmin: boolean;
    mediaType?: string;
    fileId?: string;
  }[];

  @Column({ nullable: true })
  source: string;

  @Column({ default: false })
  isSecurityReport: boolean;

  @Column({ default: 'pending' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column()
  lastMessageAt: Date;
}
