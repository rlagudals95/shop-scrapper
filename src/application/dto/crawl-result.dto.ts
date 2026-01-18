import { PageType, ExtractedData } from '@/domain/entities';
import { SiteType } from '@/domain/interfaces';

/**
 * 크롤링 결과
 */
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

/**
 * 검색어 기반 크롤링 결과
 */
export interface SearchCrawlResultDto {
  success: boolean;
  /** 검색어 */
  keyword: string;
  /** 대상 사이트 */
  site: SiteType;
  /** 최종 URL */
  url: string;
  /** 추출된 데이터 (Listing) */
  data?: ExtractedData;
  /** 원본 HTML (저장용) */
  rawHtml?: string;
  /** 에러 메시지 */
  error?: string;
  /** 재시도 횟수 */
  retryCount: number;
  /** 캐시 사용 여부 */
  cached: boolean;
  /** 차단 여부 */
  blocked?: boolean;
}
