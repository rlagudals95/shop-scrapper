import { PageType } from '@/domain/entities';

export interface CrawlRequestDto {
  url: string;
  pageType?: PageType;
  forceReanalyze?: boolean;
}
