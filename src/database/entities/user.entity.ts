import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  chatId: string;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt: Date;

  @Column({ nullable: true })
  state: string;

  @Column({ nullable: true })
  preferredGroup: string;

  @Column('jsonb', { nullable: true })
  stateData: Record<string, any>;

  @Column({ default: false })
  isAdmin: boolean;

  @Column({ nullable: true })
  picture: string;

  @Column({ name: 'ystu_id', type: 'integer', nullable: true, unique: true })
  ystuId: number | null;

  @Column({ name: 'ystu_data', type: 'jsonb', nullable: true })
  ystuData: Record<string, any> | null;

  @Column({ default: 'llama-3.3-70b-versatile' })
  aiModel: string;
}
