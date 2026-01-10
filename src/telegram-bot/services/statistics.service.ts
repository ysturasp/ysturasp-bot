import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  getActualGroupsKey,
  getStatisticsDisciplinesKey,
  getStatisticsSubjectKey,
} from '../../helpers/redis-keys';

export type InstituteId =
  | 'btn-digital-systems'
  | 'btn-architecture-design'
  | 'btn-civil-transport'
  | 'btn-chemistry'
  | 'btn-economics-management'
  | 'btn-engineering-machinery';

export interface SubjectStatistics {
  average: number;
  count5: number;
  count4: number;
  count3: number;
  count2: number;
  totalCount: number;
  byCourse: Array<{ course: number; average: number; count: number }>;
  bySemester: Array<{ semester: number; average: number; count: number }>;
  byControlType: Array<{
    controlType: string;
    average: number;
    count: number;
  }>;
  inDiplomaCount: number;
  inDiplomaPercent: number;
  topGroups: Array<{ groupName: string; average: number; count: number }>;
}

interface ActualGroupsResponse {
  isCache: boolean;
  name: string;
  items: Array<{
    name: string;
    groups: string[];
  }>;
}

@Injectable()
export class StatisticsService {
  private readonly logger = new Logger(StatisticsService.name);
  private readonly baseUrl = 'https://ysturasp.ru/api';
  private readonly scheduleBaseUrl = 'https://gg-api.ystuty.ru/s/schedule/v1';

  constructor(
    private readonly httpService: HttpService,
    @Inject('REDIS') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  private mapSectionNameToInstitute(sectionName: string): InstituteId | null {
    const normalized = sectionName.toLowerCase().trim();

    if (normalized.includes('цифровых систем')) {
      return 'btn-digital-systems';
    }
    if (normalized.includes('архитектуры и дизайна')) {
      return 'btn-architecture-design';
    }
    if (
      normalized.includes('инженеров строительства') ||
      normalized.includes('строительства и транспорта')
    ) {
      return 'btn-civil-transport';
    }
    if (normalized.includes('химии и химической технологии')) {
      return 'btn-chemistry';
    }
    if (normalized.includes('экономики и менеджмента')) {
      return 'btn-economics-management';
    }
    if (
      normalized.includes('инженерии и машиностроения') ||
      normalized.includes('машиностроения')
    ) {
      return 'btn-engineering-machinery';
    }

    return null;
  }

  async getInstituteByGroup(groupName: string): Promise<InstituteId | null> {
    const normalizedGroupName = groupName.trim().toUpperCase();
    const cacheKey = getActualGroupsKey();

    let actualGroupsData: ActualGroupsResponse | null = null;

    try {
      const cachedRaw = await this.redis.get(cacheKey);
      if (cachedRaw) {
        try {
          actualGroupsData = JSON.parse(cachedRaw) as ActualGroupsResponse;
        } catch (e) {}
      }
    } catch (e) {}

    if (!actualGroupsData) {
      try {
        const token = this.configService.get<string>('ACCESS_TOKEN');
        const { data } = await firstValueFrom(
          this.httpService.get<ActualGroupsResponse>(
            `${this.scheduleBaseUrl}/schedule/actual_groups`,
            token
              ? { headers: { Authorization: `Bearer ${token}` } }
              : undefined,
          ),
        );
        actualGroupsData = data;

        try {
          await this.redis.set(
            cacheKey,
            JSON.stringify(actualGroupsData),
            'EX',
            3600,
          );
        } catch (e) {}
      } catch (error) {
        this.logger.error(
          `Error fetching actual groups for ${groupName}:`,
          error,
        );
        return null;
      }
    }

    if (!actualGroupsData || !actualGroupsData.items) {
      return null;
    }

    for (const section of actualGroupsData.items) {
      if (section.groups && Array.isArray(section.groups)) {
        const found = section.groups.some(
          (g) => g.trim().toUpperCase() === normalizedGroupName,
        );
        if (found) {
          return this.mapSectionNameToInstitute(section.name);
        }
      }
    }

    return null;
  }

  async getDisciplines(institute: InstituteId): Promise<string[]> {
    const cacheKey = getStatisticsDisciplinesKey(institute);

    try {
      const cachedRaw = await this.redis.get(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as string[];
          if (cached && cached.length) {
            return cached;
          }
        } catch (e) {}
      }
    } catch (e) {}

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<string[]>(
          `${this.baseUrl}/stat/disciplines?institute=${institute}`,
        ),
      );
      const disciplines = data || [];

      try {
        await this.redis.set(cacheKey, JSON.stringify(disciplines), 'EX', 3600);
      } catch (e) {
        this.logger.debug('Failed to set disciplines cache', e);
      }

      return disciplines;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          `Error fetching disciplines for ${institute}:`,
          error.message,
        );
      }
      return [];
    }
  }

  async getSubjectStatistics(
    institute: InstituteId,
    discipline: string,
  ): Promise<SubjectStatistics | null> {
    const cacheKey = getStatisticsSubjectKey(institute, discipline);

    try {
      const cachedRaw = await this.redis.get(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as SubjectStatistics;
          if (cached && cached.totalCount > 0) {
            return cached;
          }
        } catch (e) {}
      }
    } catch (e) {}

    try {
      const encodedDiscipline = encodeURIComponent(discipline);
      const { data } = await firstValueFrom(
        this.httpService.get<SubjectStatistics>(
          `${this.baseUrl}/stat/subject?institute=${institute}&discipline=${encodedDiscipline}`,
        ),
      );

      if (data && data.totalCount > 0) {
        try {
          await this.redis.set(cacheKey, JSON.stringify(data), 'EX', 1296000);
        } catch (e) {}
        return data;
      }

      return null;
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 404) {
          return null;
        }
        this.logger.error(
          `Error fetching statistics for ${discipline}:`,
          error.message,
        );
      }
      return null;
    }
  }

  private normalizeForComparison(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async findMatchingDiscipline(
    institute: InstituteId,
    lessonName: string,
  ): Promise<string | null> {
    const disciplines = await this.getDisciplines(institute);
    if (!disciplines.length) {
      this.logger.debug(`No disciplines found for institute: ${institute}`);
      return null;
    }

    const normalizedLessonName = this.normalizeForComparison(lessonName);

    const exactMatch = disciplines.find(
      (d) => this.normalizeForComparison(d) === normalizedLessonName,
    );
    if (exactMatch) {
      return exactMatch;
    }

    const match = disciplines.find((d) => {
      const normalizedDiscipline = this.normalizeForComparison(d);
      const lessonWords = normalizedLessonName
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const disciplineWords = normalizedDiscipline
        .split(/\s+/)
        .filter((w) => w.length > 2);

      const matchingWords = lessonWords.filter((word) =>
        disciplineWords.some(
          (dWord) => dWord.includes(word) || word.includes(dWord),
        ),
      );

      const containsMatch =
        normalizedDiscipline.includes(normalizedLessonName) ||
        normalizedLessonName.includes(normalizedDiscipline);

      return (
        matchingWords.length >= Math.min(2, lessonWords.length) || containsMatch
      );
    });

    return match || null;
  }

  getStatisticsUrl(institute: InstituteId, discipline: string): string {
    const encodedDiscipline = encodeURIComponent(discipline);
    return `https://ysturasp.ru/stat?institute=${institute}&discipline=${encodedDiscipline}`;
  }
}
