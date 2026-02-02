import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScheduleService } from './schedule.service';

@Injectable()
export class ScheduleWarmupService {
  private readonly logger = new Logger(ScheduleWarmupService.name);

  constructor(private readonly scheduleService: ScheduleService) {}

  @Cron('0 3 * * *', { timeZone: 'Europe/Moscow' })
  async warmupScheduleCache() {
    this.logger.log('Starting schedule cache warmup...');
    const startTime = Date.now();

    try {
      await this.warmupGroups();

      await this.warmupTeachers();

      await this.warmupAudiences();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Schedule cache warmup completed in ${duration}s`);
    } catch (error) {
      this.logger.error('Error during schedule cache warmup', error);
    }
  }

  private async warmupGroups() {
    try {
      const groups = await this.scheduleService.getGroups();

      if (groups.length === 0) {
        this.logger.warn('No groups found for warmup');
        return;
      }

      this.logger.log(`Found ${groups.length} groups, warming up cache...`);

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const group of groups) {
        try {
          await this.scheduleService.getSchedule(group);
          success++;

          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          failed++;
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push(`${group}: ${errorMsg}`);
          this.logger.warn(
            `Failed to warmup schedule for ${group}: ${errorMsg}`,
          );
        }
      }

      this.logger.log(
        `Groups warmup completed. Success: ${success}, Failed: ${failed}`,
      );

      if (errors.length > 0 && errors.length <= 10) {
        this.logger.warn(`Groups warmup errors:\n${errors.join('\n')}`);
      } else if (errors.length > 10) {
        this.logger.warn(
          `Groups warmup errors (first 10):\n${errors.slice(0, 10).join('\n')}\n...and ${errors.length - 10} more`,
        );
      }
    } catch (error) {
      this.logger.error('Error during groups warmup', error);
    }
  }

  private async warmupTeachers() {
    try {
      const teachers = await this.scheduleService.getTeachers();

      if (teachers.length === 0) {
        this.logger.warn('No teachers found for warmup');
        return;
      }

      this.logger.log(`Found ${teachers.length} teachers, warming up cache...`);

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const teacher of teachers) {
        try {
          await this.scheduleService.getTeacherSchedule(teacher.id);
          success++;

          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          failed++;
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const teacherName = teacher.name || teacher.id;
          errors.push(`${teacherName}: ${errorMsg}`);
          this.logger.warn(
            `Failed to warmup schedule for teacher ${teacherName}: ${errorMsg}`,
          );
        }
      }

      this.logger.log(
        `Teachers warmup completed. Success: ${success}, Failed: ${failed}`,
      );

      if (errors.length > 0 && errors.length <= 10) {
        this.logger.warn(`Teachers warmup errors:\n${errors.join('\n')}`);
      } else if (errors.length > 10) {
        this.logger.warn(
          `Teachers warmup errors (first 10):\n${errors.slice(0, 10).join('\n')}\n...and ${errors.length - 10} more`,
        );
      }
    } catch (error) {
      this.logger.error('Error during teachers warmup', error);
    }
  }

  private async warmupAudiences() {
    try {
      const audiences = await this.scheduleService.getAudiences();

      if (audiences.length === 0) {
        this.logger.warn('No audiences found for warmup');
        return;
      }

      this.logger.log(
        `Found ${audiences.length} audiences, warming up cache...`,
      );

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const audience of audiences) {
        try {
          await this.scheduleService.getAudienceSchedule(audience.id);
          success++;

          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          failed++;
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const audienceName = audience.name || audience.id;
          errors.push(`${audienceName}: ${errorMsg}`);
          this.logger.warn(
            `Failed to warmup schedule for audience ${audienceName}: ${errorMsg}`,
          );
        }
      }

      this.logger.log(
        `Audiences warmup completed. Success: ${success}, Failed: ${failed}`,
      );

      if (errors.length > 0 && errors.length <= 10) {
        this.logger.warn(`Audiences warmup errors:\n${errors.join('\n')}`);
      } else if (errors.length > 10) {
        this.logger.warn(
          `Audiences warmup errors (first 10):\n${errors.slice(0, 10).join('\n')}\n...and ${errors.length - 10} more`,
        );
      }
    } catch (error) {
      this.logger.error('Error during audiences warmup', error);
    }
  }
}
