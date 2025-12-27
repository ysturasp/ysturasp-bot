import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
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

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  state: string;

  @Column({ nullable: true })
  preferredGroup: string;

  @Column('jsonb', { nullable: true })
  stateData: Record<string, any>;

  @Column({ default: false })
  isAdmin: boolean;
}
