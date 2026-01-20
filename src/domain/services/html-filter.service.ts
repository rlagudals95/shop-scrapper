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
   * - 상품 정보 영역 (상품명, 가격, 브랜드, 옵션)
   * - 상품 상세 설명 영역
   * - 상세 이미지 영역
   * - JSON-LD 구조화 데이터
   */
  filterForPDP(html: string, options?: HtmlFilterOptions): FilteredHtml {
    const originalLength = html.length;
    const $ = cheerio.load(html);

    // 1. JSON-LD 추출 (제거 전에)
    const jsonLd = this.extractJsonLd($);

    // 2. PDP 주요 영역 추출 시도
    const pdpRegionHtml = this.extractPDPRegion($);
    if (pdpRegionHtml) {
      this.logger.debug('PDP region extracted successfully');
      const $region = cheerio.load(pdpRegionHtml);
      return this.filterPDPRegion($region, originalLength, jsonLd, options);
    }

    // 3. 영역 추출 실패 시 기본 필터링
    this.logger.debug('PDP region not found, using full HTML filtering');
    const pdpOptions: HtmlFilterOptions = {
      keepSelectors: [
        // 상품 정보
        '[class*="product"]',
        '[class*="Product"]',
        '[class*="prod-"]',
        '[class*="goods"]',
        '[class*="item"]',
        // 가격
        '[class*="price"]',
        '[class*="Price"]',
        '[class*="sale"]',
        '[class*="cost"]',
        // 상세 정보
        '[class*="detail"]',
        '[class*="Detail"]',
        '[class*="info"]',
        '[class*="Info"]',
        '[class*="description"]',
        '[class*="desc"]',
        // 옵션
        '[class*="option"]',
        '[class*="Option"]',
        'select',
        // 이미지
        '[class*="image"]',
        '[class*="Image"]',
        '[class*="gallery"]',
        '[class*="thumb"]',
        // 브랜드
        '[class*="brand"]',
        '[class*="Brand"]',
        '[class*="seller"]',
        // 제목
        'h1',
        'h2',
        'title',
      ],
      removeSelectors: [
        ...this.confusingElementSelectors,
        // PDP에서 불필요한 요소
        '[class*="review"]',
        '[class*="Review"]',
        '[class*="comment"]',
        '[class*="qna"]',
        '[class*="Q&A"]',
        '[class*="recommend"]',
        '[class*="related"]',
        '[class*="similar"]',
        ...(options?.removeSelectors || []),
      ],
      extractJsonLd: false, // 이미 추출함
      maxLength: options?.maxLength || 100000, // PDP는 Listing보다 더 많은 컨텐츠 허용
      ...options,
    };

    const result = this.filter(html, pdpOptions);
    result.jsonLd = jsonLd;
    return result;
  }

  /**
   * PDP 주요 영역 추출
   */
  private extractPDPRegion($: ReturnType<typeof cheerio.load>): string | null {
    // PDP 상품 정보 컨테이너 선택자 (사이트 독립적)
    // 순서 중요: 가격 정보가 포함된 큰 영역을 먼저 찾아야 함
    const pdpContainerSelectors = [
      // 쿠팡 패턴 - prod-atf가 전체 상품 정보 영역 (ATF = Above The Fold)
      '[class*="prod-atf"]',
      '[class*="prodAtf"]',
      // 범용 큰 영역 (우선순위 높음) - 네이버 스마트스토어는 해시 클래스 사용
      '#content',
      '[role="main"]',
      'main',
      // 네이버 스마트스토어 패턴
      '[class*="_productDetail"]',
      '[class*="ProductDetail"]',
      '[class*="product_detail"]',
      // 범용 패턴
      '[class*="product-detail"]',
      '[class*="productDetail"]',
      '[class*="goods-detail"]',
      '[class*="goodsDetail"]',
      // 상품 페이지 메인 영역
      'main[class*="product"]',
      '.content',
      '[class*="pdp"]',
      '[class*="PDP"]',
      // 하위 영역 (폴백) - product_info는 "상품정보 제공고시" 테이블에 매칭될 수 있으므로 후순위
      '[class*="prod-buy"]',
      '[class*="prodBuy"]',
      '[class*="product_info"]',
      '[class*="productInfo"]',
    ];

    // 가격 패턴: XX,XXX원 형태
    const pricePattern = /\d{1,3}(,\d{3})*원/;

    // 1차: 가격 정보가 포함된 충분히 큰 영역 찾기 (최소 10KB)
    for (const selector of pdpContainerSelectors) {
      try {
        const container = $(selector);
        if (container.length > 0) {
          const html = container.first().html();
          // 가격 패턴이 포함되고 10KB 이상인 영역 우선 선택
          if (html && html.length > 10000 && pricePattern.test(html)) {
            this.logger.debug(`PDP region found with selector: ${selector} (${html.length} bytes, has price)`);
            return html;
          }
        }
      } catch {
        // 잘못된 선택자 무시
      }
    }

    // 2차: 가격 없어도 충분히 큰 영역 찾기 (최소 5KB)
    for (const selector of pdpContainerSelectors) {
      try {
        const container = $(selector);
        if (container.length > 0) {
          const html = container.first().html();
          if (html && html.length > 5000) {
            this.logger.debug(`PDP region found with selector: ${selector} (${html.length} bytes, fallback)`);
            return html;
          }
        }
      } catch {
        // 잘못된 선택자 무시
      }
    }

    // 3차: 기존 로직 (최소 1KB)
    for (const selector of pdpContainerSelectors) {
      try {
        const container = $(selector);
        if (container.length > 0) {
          const html = container.first().html();
          if (html && html.length > 1000) {
            this.logger.debug(`PDP region found with selector: ${selector} (${html.length} bytes, minimal)`);
            return html;
          }
        }
      } catch {
        // 잘못된 선택자 무시
      }
    }

    // 상품 상세 이미지 영역도 포함
    const detailImageSelectors = [
      '[class*="detail-content"]',
      '[class*="detailContent"]',
      '[class*="product-content"]',
      '[class*="productContent"]',
      '[class*="goods-content"]',
      '[class*="description-content"]',
    ];

    let combinedHtml = '';

    // 상품 정보 영역 (body에서 주요 부분)
    const mainContent = $('main, [role="main"], #content, .content').first();
    if (mainContent.length > 0) {
      combinedHtml = mainContent.html() || '';
    }

    // 상세 이미지 영역 추가
    for (const selector of detailImageSelectors) {
      try {
        const detailContent = $(selector);
        if (detailContent.length > 0) {
          const detailHtml = detailContent.first().html();
          if (detailHtml && detailHtml.length > 500) {
            combinedHtml += '\n' + detailHtml;
            this.logger.debug(`Detail image region added with selector: ${selector}`);
          }
        }
      } catch {
        // 무시
      }
    }

    if (combinedHtml.length > 1000) {
      return combinedHtml;
    }

    return null;
  }

  /**
   * 추출된 PDP 영역 필터링
   */
  private filterPDPRegion(
    $: ReturnType<typeof cheerio.load>,
    originalLength: number,
    jsonLd: unknown,
    options?: HtmlFilterOptions,
  ): FilteredHtml {
    // 불필요한 요소 제거 (리뷰, 추천 상품 등)
    const removeSelectors = [
      '[class*="review"]',
      '[class*="Review"]',
      '[class*="comment"]',
      '[class*="qna"]',
      '[class*="recommend"]',
      '[class*="related"]',
      '[class*="similar"]',
      '[class*="banner"]',
      '[class*="modal"]',
      '[class*="popup"]',
      ...this.confusingElementSelectors,
      ...(options?.removeSelectors || []),
    ];

    for (const selector of removeSelectors) {
      try {
        $(selector).remove();
      } catch {
        // 무시
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
    const maxLength = options?.maxLength || 100000;
    if (filtered.length > maxLength) {
      filtered = filtered.substring(0, maxLength);
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
      `HTML filtered (PDP region): ${originalLength.toLocaleString()} → ${filteredLength.toLocaleString()} bytes (${compressionRatio}% reduced)`,
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
