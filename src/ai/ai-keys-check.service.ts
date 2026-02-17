import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { User } from '../database/entities/user.entity';
import { GroqService } from './groq.service';

@Injectable()
export class AiKeysCheckService {
  private readonly logger = new Logger(AiKeysCheckService.name);
  private lastNotifiedActiveKeys: number | null = null;

  constructor(
    private readonly groqService: GroqService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectBot() private readonly bot: Telegraf,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Europe/Moscow' })
  async checkKeysAndNotifyAdmins() {
    try {
      await this.groqService.checkAllKeysHealth();
      const stats = await this.groqService.getPoolStats();

      const userCount = await this.userRepository.count();
      const requiredMinKeys =
        await this.groqService.getRequiredMinKeys(userCount);

      if (stats.activeKeys < requiredMinKeys) {
        if (
          this.lastNotifiedActiveKeys === null ||
          stats.activeKeys < this.lastNotifiedActiveKeys
        ) {
          const message =
            `⚠️ <b>Мало ключей Groq</b>\n\n` +
            `Сейчас активных ключей: <b>${stats.activeKeys}</b> из ${stats.totalKeys}\n` +
            `Рекомендуется минимум <b>${requiredMinKeys}</b> (для ${userCount} пользователей).\n\n` +
            `Добавьте новые ключи через /ai_stats → «➕ Добавить ключ(и)»`;

          const admins = await this.userRepository.find({
            where: { isAdmin: true },
          });

          for (const admin of admins) {
            try {
              await this.bot.telegram.sendMessage(admin.chatId, message, {
                parse_mode: 'HTML',
              });
            } catch (e: any) {
              this.logger.error(
                `Failed to send keys alert to admin ${admin.chatId}`,
                e,
              );
            }
          }

          this.lastNotifiedActiveKeys = stats.activeKeys;

          this.logger.warn(
            `Notified ${admins.length} admin(s): ${stats.activeKeys}/${requiredMinKeys} Groq keys (${userCount} users)`,
          );
        }
      } else {
        this.lastNotifiedActiveKeys = null;
      }
    } catch (e: any) {
      this.logger.error('Error in hourly keys check', e);
    }
  }
}
