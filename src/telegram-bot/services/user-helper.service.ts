import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { User } from '../../database/entities/user.entity';

@Injectable()
export class UserHelperService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async getUser(ctx: Context): Promise<User> {
    const chatId = String(ctx.chat?.id);
    const adminChatId = this.configService.get<string>('ADMIN_CHAT_ID');
    let user = await this.userRepository.findOne({ where: { chatId } });
    if (!user) {
      user = this.userRepository.create({
        chatId,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        username: ctx.from?.username,
        isAdmin: chatId === adminChatId,
      });
      await this.userRepository.save(user);
    } else {
      if (user.isBlocked) {
        user.isBlocked = false;
      }

      if (user.isAdmin !== (chatId === adminChatId)) {
        user.isAdmin = chatId === adminChatId;
      }
      if (!user.username && ctx.from?.username) {
        user.username = ctx.from.username;
      }
      if (!user.firstName && ctx.from?.first_name) {
        user.firstName = ctx.from.first_name;
      }
      if (!user.lastName && ctx.from?.last_name) {
        user.lastName = ctx.from.last_name;
      }

      await this.userRepository.save(user);
    }
    return user;
  }
}
