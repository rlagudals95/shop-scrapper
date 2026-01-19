import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { createLogger } from '@/common';

export interface HtmlFilterOptions {
  /** 유지할 CSS 선택자들 */
  keepSelectors?: string[];
  /** 제거할 CSS 선택자들 */
  removeSelectors?: string[];
  /** 유지할 속성들 */
  keepAttributes?: string[];
  /** JSON-LD 추출 여부 */
  extractJsonLd?: boolean;
  /** 최대 길이 (초과 시 truncate) */
  maxLength?: number;
}

export interface FilteredHtml {
  /** 필터링된 HTML */
  html: string;
  /** JSON-LD 데이터 (있는 경우) */
  jsonLd?: unknown;
  /** 원본 길이 */
  originalLength: number;
  /** 필터링 후 길이 */
  filteredLength: number;
  /** 압축률 (%) */
  compressionRatio: number;
}

/**
 * HTML 필터링 서비스
 *
 * LLM 토큰 최적화를 위해 HTML에서 불필요한 요소를 제거하고
 * Listing/PDP 영역만 추출
 */
@Injectable()
export class HtmlFilterService {
  private readonly logger = createLogger(HtmlFilterService.name);

  // 기본 제거 대상
  private readonly defaultRemoveSelectors = [
    'script',
    'style',
    'noscript',
    'svg',
    'iframe',
    'link[rel="stylesheet"]',
    'link[rel="preload"]',
    'link[rel="dns-prefetch"]',
    'meta',
    'header',
    'footer',
    'nav',
    '.header',
    '.footer',
    '.nav',
    '.sidebar',
    '.advertisement',
    '.ad-banner',
    '[class*="banner"]',
    '[class*="modal"]',
    '[class*="popup"]',
    '[class*="toast"]',
    '[class*="cookie"]',
  ];

  // LLM 혼동 방지용 제거 대상 (상품처럼 보이지만 상품이 아닌 요소들)
  private readonly confusingElementSelectors = [
    // 네이버 연관 검색어 (상품 카드처럼 보이지만 검색어 추천)
    '[class*="relatedQueries"]',
    '[class*="RelatedQueries"]',
    '[class*="related_queries"]',
    // 광고 상품 (실제 상품 목록과 분리 필요)
    '[class*="adProduct"]',
    '[class*="AdProduct"]',
    '[class*="ad_product"]',
    '[class*="ad-product"]',
    '[class*="sponsored"]',
    '[class*="Sponsored"]',
    // 사이드바 영역
    '[class*="aside_"]',
    '[class*="Aside_"]',
    'aside',
    // 추천/인기 검색어
    '[class*="popularKeyword"]',
    '[class*="trendingSearch"]',
    '[class*="hotKeyword"]',
    // 최근 본 상품 (현재 목록과 혼동 방지)
    '[class*="recentView"]',
    '[class*="RecentView"]',
    '[class*="recent_view"]',
    // 카테고리 필터 영역
    '[class*="filterArea"]',
    '[class*="FilterArea"]',
    '[class*="filter_area"]',
  ];

  // 기본 유지 속성
  private readonly defaultKeepAttributes = [
    'class',
    'id',
    'href',
    'src',
    'data-src',
    'alt',
    'title',
    'data-product',
    'data-item',
    'data-productid',
  ];

  /**
   * Listing 페이지용 HTML 필터링
   * LLM이 혼동할 수 있는 요소(연관검색어, 광고, 사이드바)를 제거
   * 상품 목록 영역만 추출하여 토큰 절약
   */
  filterForListing(html: string, options?: HtmlFilterOptions): FilteredHtml {
    const originalLength = html.length;
    const $ = cheerio.load(html);

    // 1. JSON-LD 추출 (제거 전에)
    const jsonLd = this.extractJsonLd($);

    // 2. 상품 목록 영역만 추출 (있는 경우)
    const productRegionHtml = this.extractProductListRegion($);
    if (productRegionHtml) {
      this.logger.debug('Product list region extracted successfully');
      // 추출된 영역으로 새로 로드
      const $region = cheerio.load(productRegionHtml);
      return this.filterProductRegion($region, originalLength, jsonLd, options);
    }

    // 3. 상품 영역 추출 실패 시 기존 방식 사용
    this.logger.debug('Product region not found, using full HTML filtering');
    const listingOptions: HtmlFilterOptions = {
      keepSelectors: [
        '[class*="product"]',
        '[class*="Product"]',
        '[class*="item"]',
        '[class*="card"]',
        '[class*="list"]',
        '[class*="search"]',
        '[data-product]',
        '[data-item]',
        'a[href*="/products/"]',
        'a[href*="/vp/"]',
        'img[src*="thumbnail"]',
        'img[data-src]',
      ],
      removeSelectors: [
        ...this.confusingElementSelectors,
        ...(options?.removeSelectors || []),
      ],
      extractJsonLd: false, // 이미 추출함
      maxLength: 80000,
      ...options,
    };

    const result = this.filter(html, listingOptions);
    result.jsonLd = jsonLd;
    return result;
  }

  /**
   * 상품 목록 영역만 추출
   * 범용 패턴 기반 (특정 사이트에 의존하지 않음)
   */
  private extractProductListRegion($: ReturnType<typeof cheerio.load>): string | null {
    // 1. 먼저 상품 아이템 패턴으로 컨테이너 역추적 시도
    const productItemPatterns = [
      '[class*="product_item"]',
      '[class*="productItem"]',
      '[class*="product-item"]',
      '[class*="goods_item"]',
      '[class*="goodsItem"]',
      '[class*="goods-item"]',
      'li[class*="product"]',
      'div[class*="ProductUnit"]',
    ];

    for (const pattern of productItemPatterns) {
      try {
        const items = $(pattern);
        if (items.length >= 10) {
          // 공통 부모 찾기
          const parent = items.first().parent();
          const parentChildren = parent.children();
          // 부모의 자식 중 70% 이상이 같은 패턴이면 컨테이너로 사용
          if (parentChildren.length >= items.length * 0.7) {
            this.logger.debug(
              `Product region found via item pattern: ${pattern} (${items.length} items, parent has ${parentChildren.length} children)`,
            );
            return parent.html();
          }
        }
      } catch {
        // 잘못된 선택자 무시
      }
    }

    // 2. 범용 상품 목록 컨테이너 선택자 (사이트 독립적)
    // 순서 중요: 더 구체적인 선택자가 먼저
    const containerSelectors = [
      // 시맨틱 패턴
      '[role="list"][class*="product"]',
      '[role="listbox"][class*="product"]',
      // 범용 클래스명 패턴 (product, item, list 조합)
      '[class*="product"][class*="list"]',
      '[class*="product"][class*="grid"]',
      '[class*="basicList"]',
      '[class*="searchContent"]',
      // ID 패턴 (범용)
      '#product-list',
      'ul#productList',
      '[id*="product"][id*="list"]',
      '[id*="search"][id*="result"]',
      // data 속성 기반
      '[data-testid*="product"]',
      '[data-testid*="list"]',
      '[data-component*="list"]',
      // 일반적인 목록 구조 (마지막에 시도)
      'ul[class*="list"]',
      'ol[class*="list"]',
      'div[class*="grid"]',
      // main 또는 content 영역 내의 리스트
      'main ul',
      'main ol',
      '[id*="content"] ul',
      '[class*="content"] ul',
    ];

    // 후보들을 모아서 가장 적합한 것 선택
    const candidates: Array<{ selector: string; element: cheerio.Cheerio; childCount: number }> = [];

    for (const selector of containerSelectors) {
      try {
        const containers = $(selector);
        containers.each((_, containerEl) => {
          const container = $(containerEl);
          const children = container.children();
          // 최소 10개 이상의 반복 요소가 있어야 상품 목록으로 인정
          // (가격 비교 영역은 보통 4~6개, 실제 상품 목록은 20~50개)
          if (children.length >= 10) {
            const firstChildTag = children.first().prop('tagName');
            const sameTagCount = children.filter((_, el) => $(el).prop('tagName') === firstChildTag).length;
            if (sameTagCount >= children.length * 0.7) {
              candidates.push({ selector, element: container, childCount: children.length });
            }
          }
        });
      } catch {
        // 잘못된 선택자 무시
      }
    }

    // 가장 많은 자식 요소를 가진 컨테이너 선택 (실제 상품 목록일 가능성 높음)
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.childCount - a.childCount);
      const best = candidates[0];
      this.logger.debug(`Product region found with selector: ${best.selector} (${best.childCount} items)`);
      return best.element.html();
    }

    // 상품 영역을 찾지 못한 경우 body 전체 반환 (너무 많이 필터링하지 않기 위해)
    this.logger.debug('Product region not found, returning body content');
    const body = $('body');
    if (body.length > 0) {
      return body.html();
    }

    return null;
  }

  /**
   * 추출된 상품 영역 필터링
   */
  private filterProductRegion(
    $: ReturnType<typeof cheerio.load>,
    originalLength: number,
    jsonLd: unknown,
    options?: HtmlFilterOptions,
  ): FilteredHtml {
    // 혼동 유발 요소 제거
    for (const selector of this.confusingElementSelectors) {
      try {
        $(selector).remove();
      } catch {
        // 잘못된 선택자 무시
      }
    }

    // 추가 제거 선택자 적용
    if (options?.removeSelectors) {
      for (const selector of options.removeSelectors) {
        try {
          $(selector).remove();
        } catch {
          // 잘못된 선택자 무시
        }
      }
    }

    // 불필요한 속성 제거
    const keepAttrs = options?.keepAttributes || this.defaultKeepAttributes;
    $('*').each((_, el) => {
      if ('attribs' in el && el.attribs) {
        const attrsToRemove: string[] = [];
        for (const attr of Object.keys(el.attribs)) {
          if (!keepAttrs.includes(attr) && !attr.startsWith('data-')) {
            attrsToRemove.push(attr);
          }
        }
        for (const attr of attrsToRemove) {
          delete el.attribs[attr];
        }
      }
    });

    // 빈 요소 제거
    $('div, span, p, section, article')
      .filter(function () {
        return $(this).children().length === 0 && $(this).text().trim().length === 0;
      })
      .remove();

    // 공백 정리
    let filtered = $.html()
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();

    // 길이 제한
    const maxLength = options?.maxLength || 80000;
    if (filtered.length > maxLength) {
      filtered = filtered.substring(0, maxLength);
      // 마지막 태그가 잘리지 않도록 조정
      const lastCloseTag = filtered.lastIndexOf('</');
      if (lastCloseTag > maxLength * 0.9) {
        filtered = filtered.substring(0, lastCloseTag);
      }
    }

    const filteredLength = filtered.length;
    const compressionRatio = Math.round(
      ((originalLength - filteredLength) / originalLength) * 100,
    );

    this.logger.log(
      `HTML filtered (product region): ${originalLength.toLocaleString()} → ${filteredLength.toLocaleString()} bytes (${compressionRatio}% reduced)`,
    );

    return {
      html: filtered,
      jsonLd,
      originalLength,
      filteredLength,
      compressionRatio,
    };
  }

  /**
   * PDP 페이지용 HTML 필터링
   */
  filterForPDP(html: string, options?: HtmlFilterOptions): FilteredHtml {
    const pdpOptions: HtmlFilterOptions = {
      keepSelectors: [
        '[class*="product"]',
        '[class*="Product"]',
        '[class*="price"]',
        '[class*="Price"]',
        '[class*="detail"]',
        '[class*="info"]',
        '[class*="description"]',
        '[class*="option"]',
        '[class*="image"]',
        '[class*="brand"]',
        'h1',
        'h2',
      ],
      extractJsonLd: true,
      maxLength: 80000,
      ...options,
    };

    return this.filter(html, pdpOptions);
  }

  /**
   * 범용 HTML 필터링
   */
  filter(html: string, options: HtmlFilterOptions = {}): FilteredHtml {
    const originalLength = html.length;
    const $api = cheerio.load(html);

    // 1. JSON-LD 추출 (제거 전에)
    let jsonLd: unknown;
    if (options.extractJsonLd) {
      jsonLd = this.extractJsonLd($api);
    }

    // 2. 기본 불필요 요소 제거
    const removeSelectors = [
      ...this.defaultRemoveSelectors,
      ...(options.removeSelectors || []),
    ];

    for (const selector of removeSelectors) {
      try {
        $api(selector).remove();
      } catch {
        // 잘못된 선택자 무시
      }
    }

    // 3. 주석 제거
    $api('*')
      .contents()
      .filter(function () {
        return this.type === 'comment';
      })
      .remove();

    // 4. 불필요한 속성 제거
    const keepAttrs = options.keepAttributes || this.defaultKeepAttributes;
    $api('*').each((_, el) => {
      // cheerio Element 타입 확인
      if ('attribs' in el && el.attribs) {
        const attrsToRemove: string[] = [];
        for (const attr of Object.keys(el.attribs)) {
          if (!keepAttrs.includes(attr) && !attr.startsWith('data-')) {
            attrsToRemove.push(attr);
          }
        }
        for (const attr of attrsToRemove) {
          delete el.attribs[attr];
        }
      }
    });

    // 5. 빈 요소 제거 (텍스트/자식이 없는 요소)
    $api('div, span, p, section, article')
      .filter(function () {
        return (
          $api(this).children().length === 0 && $api(this).text().trim().length === 0
        );
      })
      .remove();

    // 6. 공백 정리
    let filtered = $api.html();
    filtered = filtered
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();

    // 7. 길이 제한
    if (options.maxLength && filtered.length > options.maxLength) {
      // body 내용만 추출 시도
      const bodyMatch = filtered.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) {
        filtered = bodyMatch[1];
      }

      if (filtered.length > options.maxLength) {
        filtered = filtered.substring(0, options.maxLength);
        // 마지막 태그가 잘리지 않도록 조정
        const lastCloseTag = filtered.lastIndexOf('</');
        if (lastCloseTag > options.maxLength * 0.9) {
          filtered = filtered.substring(0, lastCloseTag);
        }
      }
    }

    const filteredLength = filtered.length;
    const compressionRatio = Math.round(
      ((originalLength - filteredLength) / originalLength) * 100,
    );

    this.logger.log(
      `HTML filtered: ${originalLength.toLocaleString()} → ${filteredLength.toLocaleString()} bytes (${compressionRatio}% reduced)`,
    );

    return {
      html: filtered,
      jsonLd,
      originalLength,
      filteredLength,
      compressionRatio,
    };
  }

  /**
   * JSON-LD 구조화 데이터 추출
   */
  private extractJsonLd($: ReturnType<typeof cheerio.load>): unknown {
    const jsonLdScript = $('script[type="application/ld+json"]').first();
    if (jsonLdScript.length === 0) {
      return undefined;
    }

    try {
      const jsonText = jsonLdScript.text();
      return JSON.parse(jsonText);
    } catch (error) {
      this.logger.warn('Failed to parse JSON-LD', error);
      return undefined;
    }
  }

  /**
   * 특정 영역만 추출 (CSS 선택자 기반)
   */
  extractRegion(html: string, selector: string): string | null {
    const $ = cheerio.load(html);
    const region = $(selector);

    if (region.length === 0) {
      return null;
    }

    return region.html();
  }

  /**
   * 상품 목록 영역만 추출 (범용)
   * @deprecated Use filterForListing instead which includes this functionality
   */
  extractProductList(html: string): string | null {
    const $ = cheerio.load(html);
    return this.extractProductListRegion($);
  }
}
