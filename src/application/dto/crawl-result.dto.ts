import { PageType, ExtractedData } from '@/domain/entities';

export interface CrawlResultDto {
  success: boolean;
  url: string;
  domain: string;
  pageType?: PageType;
  data?: ExtractedData;
  error?: string;
  retryCount: number;
  cached: boolean;
}
