import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('exams')
export class Exam {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  groupName: string;

  @Column()
  lessonName: string;

  @Column({ nullable: true })
  teacherName: string;

  @Column({ nullable: true })
  auditoryName: string;

  @Column()
  date: string;

  @Column({ nullable: true })
  timeRange: string;

  @Column()
  type: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
