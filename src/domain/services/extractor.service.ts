import { createLogger, ExtractionException } from '@/common';
import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  ExtractedData,
  ListingData,
  ListingProduct,
  ListingXPathMap,
  PageType,
  PDPData,
  PDPXPathMap,
  XPathMap,
} from '../entities';

type CheerioRoot = ReturnType<typeof cheerio.load>;

/** JSON-LD 상품 데이터 타입 */
interface JsonLdProduct {
  '@type': string;
  name: string;
  url: string;
  image?: string;
  offers?: {
    '@type': string;
    price: string | number;
    priceCurrency?: string;
  };
}

interface JsonLdListItem {
  '@type': string;
  position: number;
  item: JsonLdProduct;
}

interface JsonLdCollectionPage {
  '@context': string;
  '@type': string;
  name: string;
  mainEntity?: {
    '@type': string;
    itemListElement?: JsonLdListItem[];
  };
}

export interface ExtractionResult {
  data: ExtractedData;
  source: 'json-ld' | 'xpath';
  productCount: number;
}

/** 추출 품질 평가 결과 */
export interface ExtractionQuality {
  totalProducts: number;
  validProducts: number; // name + (price 또는 url) 있는 상품
  priceValidProducts: number; // 가격 패턴 매칭 (/[\d,]+원?/)
  qualityScore: number; // validProducts / totalProducts * 100
}

export interface ExtractOptions {
  baseUrl?: string; // e.g., "https://www.coupang.com"
}

@Injectable()
export class ExtractorService {
  private readonly logger = createLogger(ExtractorService.name);

  /**
   * 하이브리드 추출: JSON-LD 우선, XPath fallback
   */
  extractWithFallback(
    html: string,
    xpaths: XPathMap | null,
    pageType: PageType,
    options?: ExtractOptions,
  ): ExtractionResult {
    // 1. JSON-LD 시도 (Listing만 지원)
    if (pageType === PageType.LISTING) {
      const jsonLdData = this.extractFromJsonLd(html);
      if (jsonLdData && jsonLdData.products.length > 0) {
        this.logger.log(`JSON-LD extraction success: ${jsonLdData.products.length} products`);
        return {
          data: jsonLdData,
          source: 'json-ld',
          productCount: jsonLdData.products.length,
        };
      }
      this.logger.log('JSON-LD not available or empty, falling back to XPath');
    }

    // 2. XPath fallback
    if (!xpaths) {
      this.logger.warn('No XPath provided and JSON-LD unavailable');
      return {
        data: { products: [] } as ListingData,
        source: 'xpath',
        productCount: 0,
      };
    }

    const xpathData = this.extract(html, xpaths, pageType, options);
    const productCount = 'products' in xpathData ? xpathData.products.length : 1;

    return {
      data: xpathData,
      source: 'xpath',
      productCount,
    };
  }

  /**
   * JSON-LD에서 Listing 데이터 추출
   */
  extractFromJsonLd(html: string): ListingData | null {
    const $ = cheerio.load(html);
    const jsonLdScript = $('script[type="application/ld+json"]').first();

    if (jsonLdScript.length === 0) {
      return null;
    }

    try {
      const jsonText = jsonLdScript.text();
      const jsonLd = JSON.parse(jsonText) as JsonLdCollectionPage;

      // CollectionPage 타입 확인
      if (jsonLd['@type'] !== 'CollectionPage' || !jsonLd.mainEntity?.itemListElement) {
        return null;
      }

      const products: ListingProduct[] = jsonLd.mainEntity.itemListElement.map((item) => {
        const product = item.item;
        return {
          name: product.name || '',
          price: String(product.offers?.price || ''),
          url: product.url || '',
          thumbnail: product.image || null,
        };
      });

      return { products };
    } catch (error) {
      this.logger.warn('Failed to parse JSON-LD', error);
      return null;
    }
  }

  /**
   * XPath 기반 추출 (기존 로직)
   */
  extract(html: string, xpaths: XPathMap, pageType: PageType, options?: ExtractOptions): ExtractedData {
    try {
      if (pageType === PageType.LISTING) {
        return this.extractListing(html, xpaths as ListingXPathMap, options);
      } else {
        return this.extractPDP(html, xpaths as PDPXPathMap);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExtractionException(`Extraction failed: ${message}`);
    }
  }

  private extractListing(html: string, xpaths: ListingXPathMap, options?: ExtractOptions): ListingData {
    const $ = cheerio.load(html);
    const products: ListingData['products'] = [];

    this.logger.debug(`XPaths received: ${JSON.stringify(xpaths)}`);

    if (!xpaths || !xpaths.productCard) {
      this.logger.warn('No productCard xpath provided');
      return { products };
    }

    const containerSelector = this.xpathToSelector(xpaths.productCard);
    this.logger.debug(`Container selector: "${containerSelector}"`);

    const productCards = $(containerSelector);
    this.logger.log(`Found ${productCards.length} product containers`);

    productCards.each((_: number, element: cheerio.Element) => {
      const $card = $(element);

      const name = xpaths.name ? this.extractFromElement($, $card, xpaths.name) : null;
      const price = xpaths.price ? this.extractFromElement($, $card, xpaths.price) : null;
      const rawUrl = xpaths.url ? this.extractAttrFromElement($, $card, xpaths.url) : null;
      const thumbnail = xpaths.thumbnail ? this.extractImageSrc($, $card, xpaths.thumbnail) : null;

      // URL 정규화: 상대 경로 → 절대 경로
      const url = this.normalizeUrl(rawUrl, options?.baseUrl);

      if (name || price || url) {
        products.push({
          name: name || '',
          price: price || '',
          url: url || '',
          thumbnail: thumbnail || null,
        });
      }
    });

    this.logger.log(`Extracted ${products.length} products`);
    return { products };
  }

  private extractPDP(html: string, xpaths: PDPXPathMap): PDPData {
    const $ = cheerio.load(html);

    return {
      brandName: xpaths.brandName
        ? this.extractText($, xpaths.brandName)
        : null,
      productName: this.extractText($, xpaths.productName) || '',
      price: this.extractText($, xpaths.price) || '',
      description: xpaths.description
        ? this.extractText($, xpaths.description)
        : null,
      options: xpaths.options
        ? this.extractMultipleTexts($, xpaths.options)
        : [],
      detailImages: xpaths.detailImages
        ? this.extractMultipleAttrs($, xpaths.detailImages)
        : [],
    };
  }

  private xpathToSelector(xpathStr: string): string {
    if (!xpathStr || typeof xpathStr !== 'string') {
      this.logger.warn(`Invalid xpath: ${xpathStr}`);
      return '';
    }

    try {
      let selector = xpathStr;

      // CSS 셀렉터인지 XPath인지 감지
      // CSS 속성 셀렉터 패턴: [attr="value"], [attr*="value"] 등
      const hasCSSSelectorPattern = /\[[\w-]+[\*\^\$]?=["'][^"']+["']\]/.test(selector);
      // XPath 특징: //, ./, .//, contains(@class), text()
      // 주의: /@attr 패턴만으로는 XPath로 판별하지 않음 (CSS 셀렉터도 /@attr 마커 사용)
      const hasXPathPattern = /^\/\/|^\.\/|contains\(@|text\(\)/.test(selector);

      // CSS 셀렉터 패턴이 있고, 진짜 XPath 패턴이 없으면 CSS로 처리
      const isXPath = !hasCSSSelectorPattern && hasXPathPattern;

      if (!isXPath) {
        // 이미 CSS 셀렉터인 경우 - 속성 마커만 제거하고 반환
        selector = selector.replace(/\/@[\w-]+$/, '');
        // CSS 셀렉터에서 대괄호 안의 대괄호를 이스케이프 (e.g., fw-text-[20px] → fw-text-\[20px\])
        selector = this.escapeBracketsInSelector(selector);
        this.logger.debug(`CSS Selector (as-is): "${selector}"`);
        return selector;
      }

      // === XPath를 CSS로 변환 ===

      // 0. XPath union (|) 처리 - 첫 번째 경로만 사용
      if (selector.includes(' | ')) {
        selector = selector.split(' | ')[0];
      }

      // 1. 속성 추출 부분 제거 (/@src, /@href 등)
      selector = selector.replace(/\/@[\w-]+$/, '');

      // 2. text() 제거
      selector = selector.replace(/\/text\(\)$/, '');

      // 3. 시작 슬래시 제거
      selector = selector.replace(/^\/\//, '');
      selector = selector.replace(/^\.\/\//, '');

      // 4. XPath 조건절을 CSS 클래스로 변환
      const parts = selector.split('/').filter(Boolean);
      const cssSelectors: string[] = [];

      for (const part of parts) {
        let cssPart = part;

        // following-sibling:: axis 처리
        const siblingMatch = cssPart.match(/^following-sibling::(\w+)(?:\[(\d+)\])?/);
        if (siblingMatch) {
          cssPart = `~ ${siblingMatch[1]}`;
          cssSelectors.push(cssPart);
          continue;
        }

        // preceding-sibling:: axis - CSS로 변환 불가, 스킵
        const precedingMatch = cssPart.match(/^preceding-sibling::(\w+)/);
        if (precedingMatch) {
          continue;
        }

        // parent:: axis - CSS로 변환 불가, 스킵
        if (cssPart.startsWith('parent::')) {
          continue;
        }

        // 네임스페이스 제거 (svg:svg -> svg)
        cssPart = cssPart.replace(/^([\w-]+):(?!:)/, '');

        // 태그명과 조건 분리
        const tagOnlyMatch = cssPart.match(/^(\w+)(?:\[|$)/);
        const tag = tagOnlyMatch ? tagOnlyMatch[1] : cssPart;

        // contains(@class) 패턴 처리
        const allContainsMatches = cssPart.matchAll(/contains\(@class,\s*['"]([^'"]+)['"]\)/g);
        const classNames = Array.from(allContainsMatches).map((m) => m[1]);

        if (classNames.length > 0) {
          const cssClasses = classNames.map((className) => `[class*="${className}"]`);
          cssPart = `${tag}${cssClasses.join('')}`;
        } else if (cssPart.includes('[')) {
          const tagMatch = cssPart.match(/^(\w+)\[/);
          if (tagMatch) {
            cssPart = tagMatch[1];
          } else {
            cssPart = cssPart.replace(/\[.*\]/, '');
          }
        }

        if (cssPart) {
          cssSelectors.push(cssPart);
        }
      }

      selector = cssSelectors.join(' ').replace(/\s+/g, ' ').trim();

      // XPath에서 변환된 CSS 셀렉터도 이스케이프 적용
      selector = this.escapeBracketsInSelector(selector);

      this.logger.debug(`XPath "${xpathStr}" -> CSS "${selector}"`);
      return selector;
    } catch (error) {
      this.logger.warn(`Failed to convert xpath: ${xpathStr}`, error);
      return '';
    }
  }

  private extractFromElement(
    $: CheerioRoot,
    $context: cheerio.Cheerio,
    xpathStr: string,
  ): string | null {
    const selector = this.xpathToSelector(xpathStr);
    if (!selector) {
      this.logger.debug(`Empty selector for xpath: ${xpathStr}`);
      return null;
    }

    try {
      const $element = $context.find(selector);
      if ($element.length === 0) {
        this.logger.debug(`No element found for selector: ${selector}`);
        // 셀렉터가 매칭되지 않으면 null 반환 (전체 카드 텍스트 반환하지 않음)
        return null;
      }

      // 첫 번째 요소의 직접 텍스트만 추출 (자식 요소 텍스트 제외)
      const $first = $element.first();
      const directText = this.getDirectText($, $first);

      if (directText) {
        return directText;
      }

      // 직접 텍스트가 없으면 첫 번째 자식의 텍스트 시도
      return $first.text().trim() || null;
    } catch (error) {
      this.logger.warn(`Selector error for "${selector}": ${error}`);
      return null;
    }
  }

  /**
   * 요소의 직접 텍스트만 추출 (자식 요소 텍스트 제외)
   */
  private getDirectText(_$: CheerioRoot, $element: cheerio.Cheerio): string | null {
    const contents = $element.contents();
    let text = '';

    contents.each((_: number, node: cheerio.Element) => {
      // nodeType 3 = TEXT_NODE
      if (node.type === 'text') {
        const nodeText = (node as unknown as { data: string }).data?.trim();
        if (nodeText) {
          text += nodeText + ' ';
        }
      }
    });

    return text.trim() || null;
  }

  private extractAttrFromElement(
    $: CheerioRoot,
    $context: cheerio.Cheerio,
    xpathStr: string,
  ): string | null {
    // self/@href 또는 ./@href: productCard 자체의 속성 추출
    // 잘못된 패턴도 처리: self/@href/@href → self/@href
    const selfMatch = xpathStr.match(/^(?:self|\.)\/@(\w+)(?:\/@\w+)*$/);
    if (selfMatch) {
      const selfAttr = $context.attr(selfMatch[1]);
      if (selfAttr) return selfAttr;
      // self가 실패하면 자식 <a> 요소의 href를 시도 (LLM 오류 대응)
      if (selfMatch[1] === 'href') {
        const childLink = $context.find('a').first();
        if (childLink.length > 0) {
          return childLink.attr('href') || null;
        }
      }
      return null;
    }

    const attrMatch = xpathStr.match(/@(\w+)$/);
    const attrName = attrMatch ? attrMatch[1] : null;
    const selector = this.xpathToSelector(xpathStr);

    if (!selector) return null;

    const $element = $context.find(selector);
    if ($element.length === 0) return null;

    if (attrName) {
      return $element.first().attr(attrName) || null;
    }

    return $element.first().attr('href') || $element.first().attr('src') || null;
  }

  /**
   * 이미지 src 추출 (다중 속성 fallback: src, data-src, data-lazy-src, srcset)
   */
  private extractImageSrc(
    $: CheerioRoot,
    $context: cheerio.Cheerio,
    xpathStr: string,
  ): string | null {
    // self 패턴 처리
    const selfMatch = xpathStr.match(/^(?:self|\.)\/@(\w+)$/);
    if (selfMatch) {
      const $img = $context;
      return this.getImageSrcWithFallback($img);
    }

    const selector = this.xpathToSelector(xpathStr);
    if (!selector) return null;

    const $element = $context.find(selector);
    if ($element.length === 0) return null;

    return this.getImageSrcWithFallback($element.first());
  }

  /**
   * 이미지 요소에서 src 추출 (fallback 속성 순서: src, data-src, data-lazy-src, srcset)
   */
  private getImageSrcWithFallback($img: cheerio.Cheerio): string | null {
    const src = $img.attr('src');
    if (src && !src.startsWith('data:')) return src;

    const dataSrc = $img.attr('data-src');
    if (dataSrc) return dataSrc;

    const dataLazySrc = $img.attr('data-lazy-src');
    if (dataLazySrc) return dataLazySrc;

    const srcset = $img.attr('srcset');
    if (srcset) {
      // srcset에서 첫 번째 URL 추출
      const firstUrl = srcset.split(',')[0].trim().split(' ')[0];
      if (firstUrl) return firstUrl;
    }

    // fallback: src가 data URL이라도 반환
    return src || null;
  }

  /**
   * URL 정규화: 상대 경로를 절대 경로로 변환
   */
  private normalizeUrl(url: string | null, baseUrl?: string): string | null {
    if (!url) return null;
    if (!baseUrl) return url;

    // 이미 절대 URL인 경우
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // 프로토콜 상대 URL (//으로 시작)
    if (url.startsWith('//')) {
      return 'https:' + url;
    }

    // 루트 상대 경로 (/로 시작)
    if (url.startsWith('/')) {
      // baseUrl에서 origin만 추출
      const urlObj = new URL(baseUrl);
      return urlObj.origin + url;
    }

    // 상대 경로
    return baseUrl.replace(/\/$/, '') + '/' + url;
  }

  private extractText($: CheerioRoot, xpathStr: string): string | null {
    const selector = this.xpathToSelector(xpathStr);
    if (!selector) return null;

    const $element = $(selector);
    if ($element.length === 0) return null;

    return $element.first().text().trim() || null;
  }

  private extractMultipleTexts($: CheerioRoot, xpathStr: string): string[] {
    const selector = this.xpathToSelector(xpathStr);
    if (!selector) return [];

    const results: string[] = [];
    $(selector).each((_: number, element: cheerio.Element) => {
      const text = $(element).text().trim();
      if (text) results.push(text);
    });

    return results;
  }

  private extractMultipleAttrs($: CheerioRoot, xpathStr: string): string[] {
    const attrMatch = xpathStr.match(/@(\w+)$/);
    const attrName = attrMatch ? attrMatch[1] : 'src';
    const selector = this.xpathToSelector(xpathStr);

    if (!selector) return [];

    const results: string[] = [];
    $(selector).each((_: number, element: cheerio.Element) => {
      const value = $(element).attr(attrName);
      if (value) results.push(value);
    });

    return results;
  }

  /**
   * CSS 셀렉터 속성값 내의 특수문자를 이스케이프
   * 예: [class*="fw-text-[20px]"] → [class*="fw-text-\[20px\]"]
   * 예: [class*="fw-text-[20px]/[24px]"] → [class*="fw-text-\[20px\]/\[24px\]"]
   */
  private escapeBracketsInSelector(selector: string): string {
    // 정규식으로 속성 선택자를 찾아서 값 안의 대괄호를 이스케이프
    // 패턴: [attr="value"], [attr*="value"], [attr^="value"], [attr$="value"]
    return selector.replace(
      /\[([^\]]*?)([\*\^\$]?=)(["'])([^"']*)\3\]/g,
      (_match, attr, op, _quote, value) => {
        // 값 안에 대괄호가 있으면 이스케이프
        const escapedValue = value.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
        return `[${attr}${op}"${escapedValue}"]`;
      },
    );
  }

  /**
   * 추출 품질 평가 (Listing 페이지용)
   * - 유효 상품: name + (price 또는 url)이 있는 상품
   * - 가격 유효: "10,630원" 형태의 실제 가격 (할인율 "29%" 제외)
   */
  evaluateExtractionQuality(data: ListingData): ExtractionQuality {
    if (!data.products || data.products.length === 0) {
      return {
        totalProducts: 0,
        validProducts: 0,
        priceValidProducts: 0,
        qualityScore: 0,
      };
    }

    // 유효 상품: name이 있고, price 또는 url 중 하나라도 있는 상품
    const validProducts = data.products.filter(
      (p) => p.name && p.name.trim().length > 0 && (p.price || p.url),
    );

    // 가격 유효 상품: 실제 가격 패턴 매칭 (할인율 제외)
    // 실제 가격: "10,630원", "5,100원", "21,000"
    // 할인율 (무효): "29 %", "44%", "10%"
    const pricePattern = /^[\d,]+원?$/;
    const discountPattern = /^\d+\s*%$/;

    const priceValidProducts = data.products.filter((p) => {
      if (!p.price) return false;
      const trimmed = p.price.trim();
      return pricePattern.test(trimmed) && !discountPattern.test(trimmed);
    });

    const qualityScore =
      data.products.length > 0
        ? Math.round((validProducts.length / data.products.length) * 100)
        : 0;

    this.logger.debug(
      `Extraction quality: ${validProducts.length}/${data.products.length} valid (${qualityScore}%), ${priceValidProducts.length} with valid price`,
    );

    return {
      totalProducts: data.products.length,
      validProducts: validProducts.length,
      priceValidProducts: priceValidProducts.length,
      qualityScore,
    };
  }

  /**
   * 추출 품질이 기준을 충족하는지 확인
   * - 최소 5개 상품
   * - 80% 이상 유효 상품 (name + price/url 있음)
   * - 50% 이상 가격 유효 상품 (실제 가격 패턴)
   */
  isQualityAcceptable(quality: ExtractionQuality): boolean {
    return (
      quality.totalProducts >= 5 &&
      quality.qualityScore >= 80 &&
      quality.priceValidProducts >= quality.totalProducts * 0.5
    );
  }
}
