import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface CheckLimitResponse {
  can: boolean;
  reason?: string;
  remaining?: number;
}

interface UseFormatResponse {
  success: boolean;
  remaining: number;
  reason?: string;
}

interface CreatePaymentResponse {
  paymentId: string;
  confirmationUrl?: string;
  paymentType: 'yookassa';
}

interface ProcessDocumentResponse {
  success: boolean;
  formattedBase64?: string;
  remaining: number;
  reason?: string;
}

interface PaymentStatusResponse {
  status: string;
  formatsAdded: number;
  updated: boolean;
}

@Injectable()
export class FormatLimitClient {
  private readonly logger = new Logger(FormatLimitClient.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('FORMAT_SERVICE_BASE_URL') ??
      this.configService.get<string>('WEBAPP_BASE_URL') ??
      '';

    this.token = this.configService.get<string>('INTERNAL_API_TOKEN') ?? '';

    if (!this.baseUrl || !this.token) {
      this.logger.warn(
        'FORMAT_SERVICE_BASE_URL or INTERNAL_API_TOKEN is not configured. FormatLimitClient will be disabled.',
      );
    }

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private isEnabled(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  async checkLimit(
    userId: string,
    isTelegram = true,
  ): Promise<CheckLimitResponse> {
    if (!this.isEnabled()) {
      this.logger.warn('checkLimit called but client is not enabled');
      return {
        can: false,
        reason: 'Format service is not configured',
        remaining: 0,
      };
    }

    try {
      const { data } = await this.http.post<CheckLimitResponse>(
        '/api/internal/format/check-limit',
        {
          userId,
          isTelegram,
        },
        {
          headers: {
            'x-internal-token': this.token,
          },
        },
      );

      return data;
    } catch (error) {
      this.logger.error('Failed to check format limit', error as any);
      return { can: false, reason: 'Failed to check limit', remaining: 0 };
    }
  }

  async consumeFormat(
    userId: string,
    fileName: string,
    options?: { isTelegram?: boolean; isPaid?: boolean },
  ): Promise<UseFormatResponse> {
    if (!this.isEnabled()) {
      this.logger.warn('consumeFormat called but client is not enabled');
      return { success: true, remaining: Number.MAX_SAFE_INTEGER };
    }

    const isTelegram = options?.isTelegram ?? true;
    const isPaid = options?.isPaid ?? false;

    try {
      const { data } = await this.http.post<UseFormatResponse>(
        '/api/internal/format/use',
        {
          userId,
          fileName,
          isTelegram,
          isPaid,
        },
        {
          headers: {
            'x-internal-token': this.token,
          },
        },
      );

      return data;
    } catch (error: any) {
      this.logger.error('Failed to consume format', error);

      if (error?.response?.status === 429 && error.response.data) {
        const payload = error.response.data as Partial<UseFormatResponse>;
        return {
          success: false,
          remaining: payload.remaining ?? 0,
          reason: payload.reason ?? 'Limit exceeded',
        };
      }

      return {
        success: false,
        remaining: 0,
        reason: 'Internal error while consuming format',
      };
    }
  }

  async createPayment(
    userId: string,
    formatsCount?: number,
    options?: { isTelegram?: boolean },
  ): Promise<CreatePaymentResponse> {
    if (!this.isEnabled()) {
      this.logger.warn('createPayment called but client is not enabled');
      throw new Error('FormatLimitClient is not configured');
    }

    const isTelegram = options?.isTelegram ?? true;

    const { data } = await this.http.post<CreatePaymentResponse>(
      '/api/internal/payment/create',
      {
        userId,
        isTelegram,
        formatsCount,
      },
      {
        headers: {
          'x-internal-token': this.token,
        },
      },
    );

    return data;
  }

  async processDocument(
    userId: string,
    fileName: string,
    fileBase64: string,
    options?: { isTelegram?: boolean },
  ): Promise<ProcessDocumentResponse> {
    if (!this.isEnabled()) {
      this.logger.warn('processDocument called but client is not enabled');
      return {
        success: false,
        remaining: 0,
        reason: 'Format service is not configured',
      };
    }

    const isTelegram = options?.isTelegram ?? true;

    try {
      const { data } = await this.http.post<ProcessDocumentResponse>(
        '/api/internal/format/process',
        {
          userId,
          fileName,
          fileBase64,
          isTelegram,
        },
        {
          timeout: 60_000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: {
            'x-internal-token': this.token,
          },
        },
      );

      return data;
    } catch (error: any) {
      this.logger.error('Failed to process document', error);
      if (error?.response?.data) {
        const payload = error.response.data as Partial<ProcessDocumentResponse>;
        return {
          success: false,
          remaining: payload.remaining ?? 0,
          reason: payload.reason ?? payload?.['error'] ?? 'Process failed',
        };
      }
      return {
        success: false,
        remaining: 0,
        reason: 'Internal error while processing document',
      };
    }
  }

  async checkPaymentStatus(
    userId: string,
    paymentId: string,
    options?: { isTelegram?: boolean },
  ): Promise<PaymentStatusResponse> {
    if (!this.isEnabled()) {
      throw new Error('FormatLimitClient is not configured');
    }

    const isTelegram = options?.isTelegram ?? true;

    const { data } = await this.http.post<PaymentStatusResponse>(
      '/api/internal/payment/status',
      {
        userId,
        paymentId,
        isTelegram,
      },
      {
        headers: {
          'x-internal-token': this.token,
        },
      },
    );

    return data;
  }
}
