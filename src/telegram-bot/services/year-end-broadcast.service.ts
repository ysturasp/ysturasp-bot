import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import { User } from '../../database/entities/user.entity';
import { Subscription } from '../../database/entities/subscription.entity';

@Injectable()
export class YearEndBroadcastService {
  private readonly logger = new Logger(YearEndBroadcastService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
  ) {}

  async handleYearEndBroadcast(ctx: Context) {
    const users = await this.userRepository.find({
      order: { createdAt: 'ASC' },
    });

    const totalUsers = users.length;
    let success = 0;
    let failed = 0;
    const blocked: string[] = [];

    const totalSubscriptions = await this.subscriptionRepository.count();

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const userOrderNumber = i + 1;
      try {
        const message = await this.generatePersonalizedMessage(
          user,
          totalUsers,
          totalSubscriptions,
          userOrderNumber,
        );
        await ctx.telegram.sendMessage(user.chatId, message, {
          parse_mode: 'HTML',
        });
        success++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (e: any) {
        failed++;
        if (e.response?.error_code === 403) {
          blocked.push(user.username || user.chatId);
        }
        this.logger.error(`Failed to send message to user ${user.chatId}`, e);
      }
    }

    await ctx.reply(
      `Новогодняя рассылка завершена!\n\nОтправлено: ${success} пользователям\nОшибок: ${failed}${blocked.length > 0 ? `\n\nЗаблокировали бота: ${blocked.length}` : ''}`,
    );
  }

  private async generatePersonalizedMessage(
    user: User,
    totalUsers: number,
    totalSubscriptions: number,
    userOrderNumber: number,
  ): Promise<string> {
    const firstVisitDate = user.createdAt;
    const now = new Date();
    const daysSinceJoin = Math.floor(
      (now.getTime() - firstVisitDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const monthsSinceJoin = Math.floor(daysSinceJoin / 30);
    const yearsSinceJoin = Math.floor(daysSinceJoin / 365);

    const userSubscriptions = await this.subscriptionRepository.count({
      where: { userId: user.id },
    });

    const formattedDate = this.formatDate(firstVisitDate);
    const userName = user.firstName || 'друг';

    let timeMessage = '';
    let personalNote = '';

    if (daysSinceJoin < 30) {
      timeMessage = `недавно присоединились к нашему боту`;
      personalNote = `вы только начинаете свой путь с нами, и это здорово! 🎉 впереди вас ждет много полезных функций и удобных возможностей`;
    } else if (daysSinceJoin < 90) {
      timeMessage = `уже ${monthsSinceJoin} ${this.getMonthWord(monthsSinceJoin)} с нами`;
      personalNote = `вы быстро освоились, и мы рады видеть ваш интерес! 💫 продолжайте пользоваться ботом — впереди еще много интересного`;
    } else if (daysSinceJoin < 365) {
      timeMessage = `уже ${monthsSinceJoin} ${this.getMonthWord(monthsSinceJoin)} с нами`;
      personalNote = `за это время мы стали для вас надежным помощником! 🌟 благодарим за доверие и постоянное использование`;
    } else {
      const remainingMonths = Math.floor((daysSinceJoin % 365) / 30);
      if (remainingMonths > 0) {
        timeMessage = `уже ${yearsSinceJoin} ${this.getYearWord(yearsSinceJoin)} и ${remainingMonths} ${this.getMonthWord(remainingMonths)} с нами`;
      } else {
        timeMessage = `уже ${yearsSinceJoin} ${this.getYearWord(yearsSinceJoin)} с нами`;
      }
      personalNote = `вы настоящий ветеран нашего сообщества! 🏆 за это время прошло ${daysSinceJoin} ${this.getDayWord(daysSinceJoin)}, мы прошли долгий путь вместе, и впереди нас ждет еще много интересного`;
    }

    const subscriptionText =
      userSubscriptions > 0
        ? `🔔 у вас ${userSubscriptions} ${this.getSubscriptionWord(userSubscriptions)} на уведомления`
        : '';

    const orderText = `🎯 вы ${userOrderNumber}-${this.getUserOrderWord(userOrderNumber)} пользователь, присоединившийся к нашему боту`;

    return `🎉✨ уважаемый ${userName}! ✨🎉

мы встретились впервые ${formattedDate},
когда вы написали боту ysturasp команду /start.
${orderText}
с этого момента ${timeMessage}, и началась наша совместная история! 🌟💫

${personalNote}

${subscriptionText}

📊 небольшая статистика нашего сообщества:
👥 всего ${totalUsers} ${this.getUserWord(totalUsers)} в боте
🔔 всего ${totalSubscriptions} ${this.getSubscriptionWord(totalSubscriptions)} на уведомления

спасибо за то, что были с нами в этом году!

🎄✨ с наступающими праздниками!
пусть новый год принесет больше успехов, меньше проблем и только актуальное расписание! 🌟

ваш ysturasp 🙀`;
  }

  private getMonthWord(months: number): string {
    if (months === 1) return 'месяц';
    if (months >= 2 && months <= 4) return 'месяца';
    return 'месяцев';
  }

  private getYearWord(years: number): string {
    if (years === 1) return 'год';
    if (years >= 2 && years <= 4) return 'года';
    return 'лет';
  }

  private getSubscriptionWord(count: number): string {
    if (count === 1) return 'подписка';
    if (count >= 2 && count <= 4) return 'подписки';
    return 'подписок';
  }

  private getUserOrderWord(order: number): string {
    return 'й';
  }

  private getDayWord(days: number): string {
    const lastDigit = days % 10;
    const lastTwoDigits = days % 100;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
      return 'дней';
    }

    if (lastDigit === 1) return 'день';
    if (lastDigit >= 2 && lastDigit <= 4) return 'дня';
    return 'дней';
  }

  private getUserWord(count: number): string {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
      return 'пользователей';
    }

    if (lastDigit === 1) return 'пользователь';
    if (lastDigit >= 2 && lastDigit <= 4) return 'пользователя';
    return 'пользователей';
  }

  private formatDate(date: Date): string {
    const day = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear();
    const monthName = this.getMonthName(month);
    return `${day} ${monthName} ${year}`;
  }

  private getMonthName(monthIndex: number): string {
    const months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ];
    return months[monthIndex];
  }
}
