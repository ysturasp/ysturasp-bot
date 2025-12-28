import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { validate, parse } from '@tma.js/init-data-node';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CheckNotificationStatusDto } from './dto/check-notification-status.dto';
import { ToggleNotificationDto } from './dto/toggle-notification.dto';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';

@Controller('api/notifications')
export class TelegramWebappController {
  private readonly logger = new Logger(TelegramWebappController.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly configService: ConfigService,
  ) {}

  private validateTelegramInitData(initData: string): {
    userId: string;
    username?: string;
  } | null {
    try {
      const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
      if (!botToken) {
        this.logger.error('TELEGRAM_BOT_TOKEN not configured');
        return null;
      }

      try {
        validate(initData, botToken);
      } catch (error) {
        this.logger.warn('Invalid initData signature', error);
        return null;
      }

      const parsed = parse(initData);
      const user = parsed.user;

      if (!user || !user.id) {
        this.logger.warn('User data not found in initData');
        return null;
      }

      const userId = String(user.id as number | string);
      const username = user.username
        ? String(user.username)
        : user.firstName
          ? String(user.firstName)
          : undefined;

      return {
        userId,
        username,
      };
    } catch (error) {
      this.logger.error('Error validating initData', error);
      return null;
    }
  }

  private async getOrCreateUser(
    chatId: string,
    username?: string,
  ): Promise<User> {
    let user = await this.userRepository.findOne({
      where: { chatId },
    });

    if (!user) {
      user = this.userRepository.create({
        chatId,
        username,
      });
      await this.userRepository.save(user);
      this.logger.log(`Created new user with chatId: ${chatId}`);
    } else if (username && user.username !== username) {
      user.username = username;
      await this.userRepository.save(user);
    }

    return user;
  }

  @Post('check-status')
  @HttpCode(HttpStatus.OK)
  async checkNotificationStatus(
    @Body() dto: CheckNotificationStatusDto,
  ): Promise<{
    success: boolean;
    subscribed?: boolean;
    notifyMinutes?: number;
    subscriptions?: Array<{
      groupName: string;
      notifyMinutes: number;
      hiddenSubjects: any[];
      excludeHidden: boolean;
      manuallyExcludedSubjects: string[];
    }>;
    message?: string;
  }> {
    const userData = this.validateTelegramInitData(dto.initData);
    if (!userData) {
      throw new UnauthorizedException('Invalid or missing Telegram initData');
    }

    try {
      const user = await this.getOrCreateUser(
        userData.userId,
        userData.username,
      );

      const subscriptions = await this.subscriptionRepository.find({
        where: {
          user: { id: user.id },
          isActive: true,
        },
      });

      if (dto.groupName) {
        const groupSubscription = subscriptions.find(
          (sub) => sub.groupName === dto.groupName,
        );

        if (groupSubscription) {
          return {
            success: true,
            subscribed: true,
            notifyMinutes: groupSubscription.notifyMinutes,
            subscriptions: subscriptions.map((sub) => ({
              groupName: sub.groupName,
              notifyMinutes: sub.notifyMinutes,
              hiddenSubjects: sub.hiddenSubjects || [],
              excludeHidden: sub.excludeHidden,
              manuallyExcludedSubjects: sub.manuallyExcludedSubjects || [],
            })),
          };
        } else {
          return {
            success: true,
            subscribed: false,
            subscriptions: subscriptions.map((sub) => ({
              groupName: sub.groupName,
              notifyMinutes: sub.notifyMinutes,
              hiddenSubjects: sub.hiddenSubjects || [],
              excludeHidden: sub.excludeHidden,
              manuallyExcludedSubjects: sub.manuallyExcludedSubjects || [],
            })),
          };
        }
      }

      return {
        success: true,
        subscribed: subscriptions.length > 0,
        subscriptions: subscriptions.map((sub) => ({
          groupName: sub.groupName,
          notifyMinutes: sub.notifyMinutes,
          hiddenSubjects: sub.hiddenSubjects || [],
          excludeHidden: sub.excludeHidden,
          manuallyExcludedSubjects: sub.manuallyExcludedSubjects || [],
        })),
      };
    } catch (error) {
      this.logger.error('Error checking notification status', error);
      throw new BadRequestException('Failed to check notification status');
    }
  }

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  async toggleNotification(@Body() dto: ToggleNotificationDto): Promise<{
    success: boolean;
    subscribed?: boolean;
    message?: string;
  }> {
    const userData = this.validateTelegramInitData(dto.initData);
    if (!userData) {
      throw new UnauthorizedException('Invalid or missing Telegram initData');
    }

    try {
      const user = await this.getOrCreateUser(
        userData.userId,
        userData.username,
      );

      let subscription = await this.subscriptionRepository.findOne({
        where: {
          user: { id: user.id },
          groupName: dto.groupName,
        },
      });

      const isUpdate = dto.update === true;
      const notifyMinutes = Number(dto.notifyMinutes);
      const isDisable = notifyMinutes === 0 && !isUpdate;
      const hiddenSubjects = dto.hiddenSubjects || [];
      const excludeHidden =
        dto.excludeHidden !== undefined
          ? dto.excludeHidden
          : hiddenSubjects.length > 0;
      const manuallyExcludedSubjects = dto.manuallyExcludedSubjects || [];

      if (subscription) {
        if (isDisable && subscription.isActive) {
          subscription.isActive = false;
          await this.subscriptionRepository.save(subscription);

          this.logger.log(
            `Deactivated subscription for user ${user.id}, group ${dto.groupName}`,
          );

          return {
            success: true,
            subscribed: false,
          };
        } else if (isUpdate) {
          if (notifyMinutes === 0) {
            subscription.isActive = false;
          } else {
            subscription.notifyMinutes = notifyMinutes;
            subscription.isActive = true;
            subscription.hiddenSubjects = hiddenSubjects;
            subscription.excludeHidden = excludeHidden;
            subscription.manuallyExcludedSubjects = manuallyExcludedSubjects;
          }
          await this.subscriptionRepository.save(subscription);

          this.logger.log(
            `Updated subscription for user ${user.id}, group ${dto.groupName}`,
          );

          return {
            success: true,
            subscribed: subscription.isActive,
          };
        } else if (!subscription.isActive) {
          if (notifyMinutes === 0) {
            throw new BadRequestException(
              'Cannot activate subscription with notifyMinutes = 0',
            );
          }
          subscription.notifyMinutes = notifyMinutes;
          subscription.isActive = true;
          subscription.hiddenSubjects = hiddenSubjects;
          subscription.excludeHidden = excludeHidden;
          subscription.manuallyExcludedSubjects = manuallyExcludedSubjects;
          await this.subscriptionRepository.save(subscription);

          this.logger.log(
            `Activated subscription for user ${user.id}, group ${dto.groupName}`,
          );

          return {
            success: true,
            subscribed: true,
          };
        } else {
          subscription.isActive = false;
          await this.subscriptionRepository.save(subscription);

          this.logger.log(
            `Toggled off subscription for user ${user.id}, group ${dto.groupName}`,
          );

          return {
            success: true,
            subscribed: false,
          };
        }
      } else {
        if (isDisable || notifyMinutes === 0) {
          return {
            success: true,
            subscribed: false,
          };
        }

        subscription = this.subscriptionRepository.create({
          user,
          groupName: dto.groupName,
          notifyMinutes,
          isActive: true,
          hiddenSubjects,
          excludeHidden,
          manuallyExcludedSubjects,
        });
        await this.subscriptionRepository.save(subscription);

        this.logger.log(
          `Created new subscription for user ${user.id}, group ${dto.groupName}`,
        );

        return {
          success: true,
          subscribed: true,
        };
      }
    } catch (error) {
      this.logger.error('Error toggling notification', error);
      throw new BadRequestException('Failed to toggle notification');
    }
  }
}
