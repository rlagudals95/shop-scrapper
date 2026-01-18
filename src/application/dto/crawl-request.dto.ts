import { PageType } from '@/domain/entities';
import { SiteType } from '@/domain/interfaces';

/**
 * URL 기반 크롤링 요청
 */
export interface CrawlRequestDto {
  url: string;
  pageType?: PageType;
  forceReanalyze?: boolean;
}

/**
 * 검색어 기반 크롤링 요청 (Listing 페이지)
 */
export interface SearchCrawlRequestDto {
  /** 검색어 (예: "헤어밴드", "갤럭시25 자급제") */
  keyword: string;
  /** 대상 사이트 (예: "coupang", "naver") */
  site: SiteType;
  /** 강제 재분석 여부 */
  forceReanalyze?: boolean;
}
