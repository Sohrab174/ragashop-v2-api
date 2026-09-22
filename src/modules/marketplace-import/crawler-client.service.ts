import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigurationService } from '../../config/configuration.service';
import { CanonicalMarketplaceIdentity } from './marketplace-url.validator';

export interface CrawlerImportPayload {
  canonicalUrl: string;
  sourceProductId: string;
  sourceUrl: string;
}

export interface CrawlerImportResponse {
  id: number;
  name: string;
}

@Injectable()
export class CrawlerClientService {
  private readonly logger = new Logger(CrawlerClientService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigurationService) {
    this.client = axios.create({
      baseURL: config.crawler.baseUrl,
      timeout: config.crawler.requestTimeoutMs,
      headers: this.buildHeaders(),
    });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.crawler.internalSecret) {
      headers['x-crawler-secret'] = this.config.crawler.internalSecret;
    }
    return headers;
  }

  async importProduct(
    identity: CanonicalMarketplaceIdentity,
  ): Promise<CrawlerImportResponse> {
    const payload: CrawlerImportPayload = {
      canonicalUrl: identity.canonicalUrl,
      sourceProductId: identity.sourceProductId,
      sourceUrl: identity.sourceUrl,
    };

    try {
      const { data } = await this.client.post<CrawlerImportResponse>(
        '/product/search',
        payload,
      );
      return data;
    } catch (error) {
      this.logger.error(
        'Crawler import request failed',
        error?.message || error,
      );
      throw error;
    }
  }

  async postAdminEndpoint<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const { data } = await this.client.post<T>(path, body);
    return data;
  }
}
