import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan, IsNull } from 'typeorm';
import { AiKey } from '../database/entities/ai-key.entity';
import axios from 'axios';
import * as FormData from 'form-data';

export class GroqService implements OnModuleInit {
  private readonly logger = new Logger(GroqService.name);
  private readonly API_URL = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly AUDIO_URL =
    'https://api.groq.com/openai/v1/audio/transcriptions';

  constructor(
    @InjectRepository(AiKey)
    private readonly aiKeyRepository: Repository<AiKey>,
  ) {}

  async onModuleInit() {
    try {
      const keys = await this.aiKeyRepository.find();
      if (keys.length > 0) {
        await this.checkAllKeysHealth();
      }
    } catch (e: any) {
      this.logger.warn(
        `Groq keys health-check on startup failed: ${e?.message || e}`,
      );
    }
  }

  async addKeys(rawInput: string): Promise<{
    added: number;
    skipped: number;
    errors: string[];
  }> {
    const normalized = rawInput
      .replace(/[\r\n]+/g, ',')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const unique = [...new Set(normalized)];

    const existing = await this.aiKeyRepository.find();
    const existingSet = new Set(existing.map((k) => k.key));

    let added = 0;
    const errors: string[] = [];

    for (const key of unique) {
      if (existingSet.has(key)) {
        continue;
      }
      try {
        const entity = this.aiKeyRepository.create({
          key,
          provider: 'groq',
          isActive: true,
          remainingRequests: 30,
          remainingTokens: 6000,
        });
        await this.aiKeyRepository.save(entity);
        existingSet.add(key);
        added++;
        this.logger.log(`Added Groq API key: ${key.substring(0, 10)}...`);
      } catch (e: any) {
        const msg = e?.message || String(e);
        errors.push(`${key.substring(0, 10)}...: ${msg}`);
      }
    }

    const skipped = unique.length - added - errors.length;
    return { added, skipped, errors };
  }

  async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string = 'llama-3.3-70b-versatile',
  ): Promise<string> {
    const aiKey = await this.pickKey();
    if (!aiKey) {
      throw new Error('No available Groq API keys');
    }

    this.logger.debug(`Using Groq key: ${aiKey.key.substring(0, 10)}...`);

    try {
      const response = await axios.post(
        this.API_URL,
        {
          model,
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${aiKey.key}`,
            'Content-Type': 'application/json',
          },
        },
      );

      await this.updateKeyLimits(aiKey, response.headers, response.data.usage);

      return response.data.choices[0].message.content;
    } catch (error) {
      if (error.response) {
        await this.updateKeyLimits(aiKey, error.response.headers);
        this.logger.error(
          `Groq API error (${model}): ${error.response.status} - ${JSON.stringify(error.response.data)}`,
        );
        if (error.response.status === 429) {
          return this.chatCompletion(messages, model);
        }
      }
      throw error;
    }
  }

  private async checkSingleKey(
    aiKey: AiKey,
    model: string = 'llama-3.3-70b-versatile',
  ): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
  }> {
    try {
      const response = await axios.post(
        this.API_URL,
        {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
        {
          headers: {
            Authorization: `Bearer ${aiKey.key}`,
            'Content-Type': 'application/json',
          },
        },
      );

      await this.updateKeyLimits(aiKey, response.headers, response.data.usage);
      return { ok: true, status: response.status };
    } catch (error: any) {
      if (error.response) {
        await this.updateKeyLimits(aiKey, error.response.headers);
        const status = error.response.status;
        const data = error.response.data;

        const code = data?.error?.code;
        if (
          status === 401 ||
          status === 403 ||
          (status === 400 && code === 'organization_restricted')
        ) {
          aiKey.isActive = false;
          await this.aiKeyRepository.save(aiKey);
          this.logger.warn(
            `Deactivated Groq key due to auth error: ${aiKey.key.substring(
              0,
              10,
            )}...`,
          );
        }

        this.logger.error(
          `Groq health-check error (${model}): ${status} - ${JSON.stringify(
            data,
          )}`,
        );
        return {
          ok: false,
          status,
          error: typeof data === 'string' ? data : JSON.stringify(data),
        };
      }

      this.logger.error(
        `Groq health-check network error: ${error?.message || error}`,
      );
      return {
        ok: false,
        error: error?.message || String(error),
      };
    }
  }

  async transcribe(buffer: Buffer, filename: string): Promise<string> {
    const aiKey = await this.pickKey();
    if (!aiKey) throw new Error('No available Groq API keys');

    const form = new FormData();
    form.append('file', buffer, { filename });
    form.append('model', 'whisper-large-v3-turbo');

    try {
      const response = await axios.post(this.AUDIO_URL, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${aiKey.key}`,
        },
      });

      await this.updateKeyLimits(aiKey, response.headers);
      return response.data.text;
    } catch (error) {
      if (error.response) {
        await this.updateKeyLimits(aiKey, error.response.headers);
        this.logger.error(
          `Groq STT error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  private async pickKey(): Promise<AiKey | null> {
    const keys = await this.aiKeyRepository.find({
      where: { isActive: true },
    });

    if (keys.length === 0) return null;

    const now = new Date();

    const availableKeys = keys.filter((k) => {
      const isRequestsLimited =
        k.remainingRequests <= 0 &&
        k.resetRequestsAt &&
        k.resetRequestsAt > now;
      const isTokensLimited =
        k.remainingTokens <= 500 && k.resetTokensAt && k.resetTokensAt > now;

      return !isRequestsLimited && !isTokensLimited;
    });

    if (availableKeys.length > 0) {
      return availableKeys.sort(
        (a, b) => b.remainingRequests - a.remainingRequests,
      )[0];
    }

    return keys.sort((a, b) => {
      const aReset = Math.max(
        a.resetRequestsAt?.getTime() || 0,
        a.resetTokensAt?.getTime() || 0,
      );
      const bReset = Math.max(
        b.resetRequestsAt?.getTime() || 0,
        b.resetTokensAt?.getTime() || 0,
      );
      return aReset - bReset;
    })[0];
  }

  private async updateKeyLimits(
    key: AiKey,
    headers: any,
    usage?: any,
  ): Promise<void> {
    const remainingRequests = parseInt(
      headers['x-ratelimit-remaining-requests'],
      10,
    );
    const remainingTokens = parseInt(
      headers['x-ratelimit-remaining-tokens'],
      10,
    );
    const resetRequestsStr = headers['x-ratelimit-reset-requests'];
    const resetTokensStr = headers['x-ratelimit-reset-tokens'];

    if (!isNaN(remainingRequests)) key.remainingRequests = remainingRequests;
    if (!isNaN(remainingTokens)) key.remainingTokens = remainingTokens;

    if (resetRequestsStr) {
      key.resetRequestsAt = this.parseResetTime(resetRequestsStr);
    }
    if (resetTokensStr) {
      key.resetTokensAt = this.parseResetTime(resetTokensStr);
    }

    if (usage) {
      key.totalTokens = Number(key.totalTokens) + (usage.total_tokens || 0);
      key.totalRequests += 1;
    }

    await this.aiKeyRepository.save(key);
  }

  private parseResetTime(timeStr: string): Date {
    const now = new Date().getTime();
    let ms = 0;

    const hMatch = timeStr.match(/(\d+)h/);
    const mMatch = timeStr.match(/(\d+)m/);
    const sMatch = timeStr.match(/(\d+(\.\d+)?)s/);

    if (hMatch) ms += parseInt(hMatch[1], 10) * 3600000;
    if (mMatch) ms += parseInt(mMatch[1], 10) * 60000;
    if (sMatch) ms += parseFloat(sMatch[1]) * 1000;

    return new Date(now + ms);
  }

  async getPoolStats() {
    const keys = await this.aiKeyRepository.find();
    const now = new Date();

    const stats = {
      totalKeys: keys.length,
      activeKeys: keys.filter((k) => k.isActive).length,
      limitedKeys: 0,
      totalTokens: 0,
      totalRequests: 0,
      soonestReset: null as Date | null,
    };

    for (const k of keys) {
      stats.totalTokens += Number(k.totalTokens);
      stats.totalRequests += k.totalRequests;

      const isRequestsLimited =
        k.remainingRequests <= 0 &&
        k.resetRequestsAt &&
        k.resetRequestsAt > now;
      const isTokensLimited =
        k.remainingTokens <= 500 && k.resetTokensAt && k.resetTokensAt > now;

      if (isRequestsLimited || isTokensLimited) {
        stats.limitedKeys++;
        const reset = new Date(
          Math.max(
            k.resetRequestsAt?.getTime() || 0,
            k.resetTokensAt?.getTime() || 0,
          ),
        );
        if (!stats.soonestReset || reset < stats.soonestReset) {
          stats.soonestReset = reset;
        }
      }
    }

    return stats;
  }

  async checkAllKeysHealth() {
    const keys = await this.aiKeyRepository.find();
    const results = [];

    for (const key of keys) {
      if (!key.isActive) {
        results.push({
          keyPrefix: key.key.substring(0, 10),
          isActive: false,
          ok: false,
          status: undefined,
          error: 'deactivated',
        });
        continue;
      }

      const res = await this.checkSingleKey(key);
      results.push({
        keyPrefix: key.key.substring(0, 10),
        isActive: key.isActive,
        ok: res.ok,
        status: res.status,
        error: res.error,
      });
    }

    return results;
  }
}
