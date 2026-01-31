import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not, IsNull } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { User } from '../database/entities/user.entity';
import { createHash, createDecipheriv, randomBytes } from 'crypto';
import { AnalyticsService } from '../analytics/analytics.service';

interface YSTUMark {
  inDiplom: number;
  markName: string | null;
  mark: number;
  semester: number;
  controlTypeName: string;
  years: string;
  course: number;
  lessonName: string;
  creditUnit: number;
  hasDebt: number;
}

interface SavedGrades {
  marks: YSTUMark[];
  hash: string;
  updatedAt: string;
}

@Injectable()
export class GradeNotificationsService {
  private readonly logger = new Logger(GradeNotificationsService.name);
  private readonly API_BASE = 'https://gg-api.ystuty.ru/s';
  private redisClient: any = null;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    @InjectBot() private readonly bot: Telegraf,
    private readonly configService: ConfigService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private getEncryptionKey(): Buffer {
    const key = this.configService.get<string>('YSTU_TOKENS_SECRET');
    if (!key) {
      throw new Error('YSTU_TOKENS_SECRET is not configured');
    }

    const buf = Buffer.from(key, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        'YSTU_TOKENS_SECRET must be a base64-encoded 32-byte key',
      );
    }
    return buf;
  }

  private decryptToken(enc: string): string {
    const key = this.getEncryptionKey();
    const data = Buffer.from(enc, 'base64');

    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  private async getRedisClient(): Promise<any> {
    if (this.redisClient) return this.redisClient;

    try {
      const Redis = require('ioredis');
      this.redisClient = new Redis({
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get<string>('REDIS_PASSWORD'),
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });
      return this.redisClient;
    } catch (error) {
      this.logger.error('Failed to initialize Redis client', error);
      return null;
    }
  }

  private async getValidAccessToken(userId: string): Promise<string | null> {
    try {
      const result = await this.dataSource.query(
        `
        SELECT access_token_enc, refresh_token_enc, access_expires_at
        FROM ystu_tokens
        WHERE user_id = $1 AND is_telegram = TRUE
        `,
        [userId],
      );

      if (!result || result.length === 0) {
        return null;
      }

      const tokenData = result[0];
      const expiresAt = new Date(tokenData.access_expires_at);

      if (expiresAt > new Date()) {
        return this.decryptToken(tokenData.access_token_enc);
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Error getting access token for user ${userId}:`,
        error,
      );
      return null;
    }
  }

  private async getMarks(accessToken: string): Promise<YSTUMark[]> {
    const response = await fetch(`${this.API_BASE}/general/v1/mark/my`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'Unable to read error response');
      const errorMessage = `Ошибка при получении оценок ЯГТУ: ${response.status} ${response.statusText}`;
      this.logger.error(
        `API Error: ${errorMessage}, Response: ${errorText.substring(0, 500)}`,
      );
      throw new Error(errorMessage);
    }

    return response.json();
  }

  private async saveUserGrades(
    userId: string,
    marks: YSTUMark[],
  ): Promise<void> {
    try {
      const redis = await this.getRedisClient();
      if (!redis) return;

      const sortedMarks = [...marks].sort((a, b) => {
        if (a.lessonName !== b.lessonName) {
          return a.lessonName.localeCompare(b.lessonName);
        }
        if (a.course !== b.course) {
          return b.course - a.course;
        }
        return b.semester - a.semester;
      });

      const marksHash = createHash('sha256')
        .update(JSON.stringify(sortedMarks))
        .digest('hex');

      const data: SavedGrades = {
        marks: sortedMarks,
        hash: marksHash,
        updatedAt: new Date().toISOString(),
      };

      const key = `grades:user:${userId}`;
      await redis.set(key, JSON.stringify(data));
    } catch (error) {
      this.logger.error(`Error saving grades for user ${userId}:`, error);
    }
  }

  private async getUserGrades(userId: string): Promise<SavedGrades | null> {
    try {
      const redis = await this.getRedisClient();
      if (!redis) return null;

      const key = `grades:user:${userId}`;
      const cached = await redis.get(key);

      if (!cached) {
        return null;
      }

      return JSON.parse(cached);
    } catch (error) {
      this.logger.error(`Error getting grades for user ${userId}:`, error);
      return null;
    }
  }

  private compareGrades(
    oldMarks: YSTUMark[] | null,
    newMarks: YSTUMark[],
  ): { added: YSTUMark[]; changed: Array<{ old: YSTUMark; new: YSTUMark }> } {
    if (!oldMarks || oldMarks.length === 0) {
      return {
        added: newMarks,
        changed: [],
      };
    }

    const oldMarksMap = new Map<string, YSTUMark>();
    for (const mark of oldMarks) {
      const key = `${mark.lessonName}-${mark.semester}-${mark.course}-${mark.controlTypeName}`;
      oldMarksMap.set(key, mark);
    }

    const added: YSTUMark[] = [];
    const changed: Array<{ old: YSTUMark; new: YSTUMark }> = [];

    for (const newMark of newMarks) {
      const key = `${newMark.lessonName}-${newMark.semester}-${newMark.course}-${newMark.controlTypeName}`;
      const oldMark = oldMarksMap.get(key);

      if (!oldMark) {
        added.push(newMark);
      } else if (
        oldMark.mark !== newMark.mark ||
        oldMark.markName !== newMark.markName ||
        oldMark.inDiplom !== newMark.inDiplom
      ) {
        changed.push({ old: oldMark, new: newMark });
      }
    }

    return { added, changed };
  }

  private formatGrade(mark: YSTUMark): string {
    if (mark.mark === 0) {
      return mark.markName || 'зачет';
    }
    if (mark.markName) {
      return `${mark.mark} (${mark.markName})`;
    }
    return String(mark.mark);
  }

  private formatGradeNotification(
    added: YSTUMark[],
    changed: Array<{ old: YSTUMark; new: YSTUMark }>,
  ): string {
    let message = '';

    if (added.length > 0) {
      if (added.length === 1) {
        message += '✨ Новая оценка!\n\n';
      } else {
        message += `✨ ${added.length} новых оценок\n\n`;
      }
      for (const mark of added) {
        const gradeStr = this.formatGrade(mark);
        message += `${mark.lessonName} — ${gradeStr}\n`;
      }
    }

    if (changed.length > 0) {
      if (added.length > 0) {
        message += '\n';
      }
      if (changed.length === 1) {
        message += '🔄 Оценка изменена\n\n';
      } else {
        message += `🔄 ${changed.length} оценок изменено\n\n`;
      }
      for (const { old: oldMark, new: newMark } of changed) {
        const oldGradeStr = this.formatGrade(oldMark);
        const newGradeStr = this.formatGrade(newMark);
        message += `${newMark.lessonName}: ${oldGradeStr} → ${newGradeStr}\n`;
      }
    }

    message += '\n<a href="https://ysturasp.ru/me">смотреть все</a>';

    return message;
  }

  private async checkUserGrades(user: User): Promise<void> {
    try {
      if (!user.chatId || !user.ystuId) {
        return;
      }

      const accessToken = await this.getValidAccessToken(user.id);
      if (!accessToken) {
        return;
      }

      const currentMarks = await this.getMarks(accessToken);
      const savedGrades = await this.getUserGrades(user.id);

      if (!savedGrades) {
        await this.saveUserGrades(user.id, currentMarks);
        return;
      }

      const changes = this.compareGrades(savedGrades.marks, currentMarks);

      if (
        (changes.added.length > 0 || changes.changed.length > 0) &&
        user.chatId
      ) {
        const message = this.formatGradeNotification(
          changes.added,
          changes.changed,
        );
        try {
          await this.bot.telegram.sendMessage(user.chatId, message, {
            parse_mode: 'HTML',
          });
          await this.analyticsService.track({
            chatId: user.chatId,
            userId: user.id,
            eventType: 'notification:grade',
            payload: {
              addedCount: changes.added.length,
              changedCount: changes.changed.length,
            },
          });
          this.logger.log(
            `Grade notification sent to user ${user.id} (chatId: ${user.chatId})`,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to send grade notification to ${user.chatId}:`,
            error,
          );
        }
      }

      await this.saveUserGrades(user.id, currentMarks);
    } catch (error: any) {
      this.logger.error(`Error checking grades for user ${user.id}:`, error);
      if (
        !error.message?.includes('недействительна') &&
        !error.message?.includes('expired')
      ) {
        throw error;
      }
    }
  }

  private isSessionPeriod(): boolean {
    const now = new Date();
    const month = now.getMonth() + 1;

    return (
      month === 12 ||
      month === 1 ||
      month === 2 ||
      month === 5 ||
      month === 6 ||
      month === 7
    );
  }

  private async checkAllUserGradesInternal() {
    this.logger.debug(
      'Checking grades for all users with notifications enabled...',
    );

    try {
      const columnCheck = await this.dataSource.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ystu_tokens' AND column_name = 'grade_notifications_enabled'
        )
      `);

      if (!columnCheck[0]?.exists) {
        try {
          await this.dataSource.query(
            `ALTER TABLE ystu_tokens ADD COLUMN grade_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
          );
          this.logger.debug(
            'Added grade_notifications_enabled column to ystu_tokens',
          );
        } catch (e: any) {
          if (
            !e.message?.includes('already exists') &&
            !e.message?.includes('duplicate')
          ) {
            this.logger.error(
              'Failed to create grade_notifications_enabled column in ystu_tokens',
              e,
            );
            return;
          }
        }
      }

      const usersWithNotifications = await this.dataSource.query(`
        SELECT u.id, u."chatId", u.ystu_id, u.username, u."firstName", u."lastName"
        FROM users u
        INNER JOIN ystu_tokens yt ON u.id = yt.user_id
        WHERE yt.is_telegram = TRUE
          AND yt.grade_notifications_enabled = TRUE
          AND u.ystu_id IS NOT NULL
          AND u."chatId" IS NOT NULL
      `);

      this.logger.debug(
        `Found ${usersWithNotifications.length} users with grade notifications enabled`,
      );

      const DELAY_BETWEEN_REQUESTS_MS = 20000;

      for (let i = 0; i < usersWithNotifications.length; i++) {
        const userData = usersWithNotifications[i];

        if (i > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS),
          );
        }

        const user = await this.userRepository.findOne({
          where: { id: userData.id },
        });

        if (user && user.chatId && user.ystuId) {
          await this.checkUserGrades(user).catch((error) => {
            if (error.message?.includes('429')) {
              this.logger.warn(`Rate limit (429) hit for user ${user.id}`);
            }
            this.logger.error(
              `Error checking grades for user ${user.id}:`,
              error,
            );
          });
        }
      }
    } catch (error) {
      this.logger.error('Error in grade check cron job:', error);
    }
  }

  @Cron('*/15 * * * *')
  async checkAllUserGradesDuringSession() {
    if (!this.isSessionPeriod()) {
      return;
    }
    await this.checkAllUserGradesInternal();
  }

  @Cron('0 12 * * *')
  async checkAllUserGradesRegular() {
    if (this.isSessionPeriod()) {
      return;
    }
    await this.checkAllUserGradesInternal();
  }
}
