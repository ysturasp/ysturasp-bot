import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  BotEvent,
  BotEventSource,
} from '../database/entities/bot-event.entity';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 24 * 60 * 60 * 1000);
}
function subMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() - n, d.getDate());
}
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function formatMonthRu(d: Date): string {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

export interface TrackEventParams {
  chatId: string;
  userId?: string | null;
  eventType: string;
  payload?: Record<string, unknown> | null;
  source?: BotEventSource;
}

export interface DailyActiveUsersRow {
  date: string;
  unique_users: string;
  total_events: string;
}

export interface EventTypeStatsRow {
  event_type: string;
  count: string;
}

export interface AnalyticsSummary {
  periodStart: string;
  periodEnd: string;
  totalEvents: number;
  uniqueUsers: number;
  eventsByType: Array<{ eventType: string; count: number }>;
  dailyActiveUsers: Array<{
    date: string;
    uniqueUsers: number;
    totalEvents: number;
  }>;
}

export interface MonthlyReport {
  month: string;
  mau: number;
  totalEvents: number;
  newUsers: number;
  topEvents: Array<{ eventType: string; count: number }>;
  dailyBreakdown: Array<{
    date: string;
    dau: number;
    events: number;
  }>;
}

export interface UserEngagement {
  totalUsers: number;
  engagedUsers: number;
  engagementRate: number;
  usersWithPreferredGroup: number;
  usersWithSubscriptions: number;
  usersWithBoth: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(BotEvent)
    private readonly eventRepository: Repository<BotEvent>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
  ) {}

  async track(params: TrackEventParams): Promise<void> {
    const {
      chatId,
      userId = null,
      eventType,
      payload = null,
      source = 'telegram',
    } = params;

    try {
      const event = this.eventRepository.create({
        chatId,
        userId,
        eventType,
        payload,
        source,
      });
      await this.eventRepository.save(event);
    } catch (err) {
      this.logger.warn(`Analytics track failed: ${(err as Error).message}`);
    }
  }

  async getDAU(startDate: Date, endDate: Date): Promise<DailyActiveUsersRow[]> {
    const qb = this.eventRepository
      .createQueryBuilder('e')
      .select("DATE(e.created_at AT TIME ZONE 'UTC')", 'date')
      .addSelect('COUNT(DISTINCT e.chat_id)', 'unique_users')
      .addSelect('COUNT(*)', 'total_events')
      .where('e.created_at >= :start', { start: startDate })
      .andWhere('e.created_at <= :end', { end: endDate })
      .groupBy("DATE(e.created_at AT TIME ZONE 'UTC')")
      .orderBy('date', 'ASC');

    const rows = await qb.getRawMany<DailyActiveUsersRow>();
    return rows;
  }

  async getMAU(month: Date): Promise<number> {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const result = await this.eventRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.chat_id)', 'count')
      .where('e.created_at >= :start', { start })
      .andWhere('e.created_at <= :end', { end })
      .getRawOne<{ count: string }>();

    return parseInt(result?.count ?? '0', 10);
  }

  async getEventsByType(
    startDate: Date,
    endDate: Date,
  ): Promise<EventTypeStatsRow[]> {
    const rows = await this.eventRepository
      .createQueryBuilder('e')
      .select('e.event_type', 'event_type')
      .addSelect('COUNT(*)', 'count')
      .where('e.created_at >= :start', { start: startDate })
      .andWhere('e.created_at <= :end', { end: endDate })
      .groupBy('e.event_type')
      .orderBy('count', 'DESC')
      .getRawMany<EventTypeStatsRow>();

    return rows;
  }

  async getTotalUsers(): Promise<number> {
    return await this.userRepository.count();
  }

  async getSummary(startDate: Date, endDate: Date): Promise<AnalyticsSummary> {
    const [totalEventsResult, uniqueResult, eventsByType, dailyActiveUsers] =
      await Promise.all([
        this.eventRepository.count({
          where: {
            createdAt: Between(startDate, endDate),
          },
        }),
        this.eventRepository
          .createQueryBuilder('e')
          .select('COUNT(DISTINCT e.chat_id)', 'count')
          .where('e.created_at >= :start', { start: startDate })
          .andWhere('e.created_at <= :end', { end: endDate })
          .getRawOne<{ count: string }>(),
        this.getEventsByType(startDate, endDate),
        this.getDAU(startDate, endDate),
      ]);

    const uniqueUsers = parseInt(uniqueResult?.count ?? '0', 10);

    return {
      periodStart: formatDate(startDate),
      periodEnd: formatDate(endDate),
      totalEvents: totalEventsResult,
      uniqueUsers,
      eventsByType: eventsByType.map((r) => ({
        eventType: r.event_type,
        count: parseInt(r.count, 10),
      })),
      dailyActiveUsers: dailyActiveUsers.map((r) => ({
        date: r.date,
        uniqueUsers: parseInt(r.unique_users, 10),
        totalEvents: parseInt(r.total_events, 10),
      })),
    };
  }

  async getMonthlyReport(month: Date): Promise<MonthlyReport> {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const summary = await this.getSummary(start, end);

    const newUsers = await this.userRepository
      .createQueryBuilder('u')
      .select('COUNT(*)', 'count')
      .where('u.createdAt >= :start', { start })
      .andWhere('u.createdAt <= :end', { end })
      .getRawOne<{ count: string }>();

    return {
      month: formatMonthRu(month),
      mau: summary.uniqueUsers,
      totalEvents: summary.totalEvents,
      newUsers: parseInt(newUsers?.count ?? '0', 10),
      topEvents: summary.eventsByType.slice(0, 15),
      dailyBreakdown: summary.dailyActiveUsers.map((d) => ({
        date: d.date,
        dau: d.uniqueUsers,
        events: d.totalEvents,
      })),
    };
  }

  async getLastDaysSummary(days: number): Promise<AnalyticsSummary> {
    const end = endOfDay(new Date());
    const start = startOfDay(subDays(new Date(), days - 1));
    return this.getSummary(start, end);
  }

  async getLastMonthReport(): Promise<MonthlyReport> {
    return this.getMonthlyReport(subMonths(new Date(), 1));
  }

  async getCurrentMonthReport(): Promise<MonthlyReport> {
    return this.getMonthlyReport(new Date());
  }

  async getUserEngagement(): Promise<UserEngagement> {
    const totalUsers = await this.userRepository.count();

    const usersWithPreferredGroup = await this.userRepository
      .createQueryBuilder('u')
      .where('u.preferredGroup IS NOT NULL')
      .andWhere("u.preferredGroup != ''")
      .getCount();

    const userIdsWithSubscriptions = await this.subscriptionRepository
      .createQueryBuilder('s')
      .select('DISTINCT s.userId', 'userId')
      .where('s.isActive = :isActive', { isActive: true })
      .getRawMany<{ userId: string }>();

    const usersWithSubscriptions = userIdsWithSubscriptions.length;

    const usersWithBoth = await this.userRepository
      .createQueryBuilder('u')
      .innerJoin(
        'subscriptions',
        's',
        's.userId = u.id AND s.isActive = :isActive',
        { isActive: true },
      )
      .where('u.preferredGroup IS NOT NULL')
      .andWhere("u.preferredGroup != ''")
      .select('COUNT(DISTINCT u.id)', 'count')
      .getRawOne<{ count: string }>();

    const engagedUsers =
      usersWithPreferredGroup +
      usersWithSubscriptions -
      parseInt(usersWithBoth?.count ?? '0', 10);

    const engagementRate =
      totalUsers > 0 ? (engagedUsers / totalUsers) * 100 : 0;

    return {
      totalUsers,
      engagedUsers,
      engagementRate: Math.round(engagementRate * 100) / 100,
      usersWithPreferredGroup,
      usersWithSubscriptions,
      usersWithBoth: parseInt(usersWithBoth?.count ?? '0', 10),
    };
  }
}
