import { createLogger, ExtractionException } from '@/common';
import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  ExtractedData,
  ListingData,
  ListingXPathMap,
  PageType,
  PDPData,
  PDPXPathMap,
  XPathMap,
} from '../entities';

type CheerioRoot = ReturnType<typeof cheerio.load>;

@Injectable()
export class ExtractorService {
  private readonly logger = createLogger(ExtractorService.name);

  extract(html: string, xpaths: XPathMap, pageType: PageType): ExtractedData {
    try {
      if (pageType === PageType.LISTING) {
        return this.extractListing(html, xpaths as ListingXPathMap);
      } else {
        return this.extractPDP(html, xpaths as PDPXPathMap);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExtractionException(`Extraction failed: ${message}`);
    }
  }

  private extractListing(html: string, xpaths: ListingXPathMap): ListingData {
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
      const url = xpaths.url ? this.extractAttrFromElement($, $card, xpaths.url) : null;
      const thumbnail = xpaths.thumbnail ? this.extractAttrFromElement($, $card, xpaths.thumbnail) : null;

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
      // 복잡한 조건절을 안전하게 처리하기 위해 단계별로 처리
      const parts = selector.split('/').filter(Boolean);
      const cssSelectors: string[] = [];

      for (const part of parts) {
        let cssPart = part;

        // following-sibling:: axis 처리 - sibling selector (~) 사용
        // 중요: 네임스페이스 제거 전에 체크해야 함 (::가 :로 잘못 처리되는 것 방지)
        const siblingMatch = cssPart.match(/^following-sibling::(\w+)(?:\[(\d+)\])?/);
        if (siblingMatch) {
          // following-sibling::td[1] -> ~ td (일반 형제 선택자)
          cssPart = `~ ${siblingMatch[1]}`;
          cssSelectors.push(cssPart);
          continue;
        }

        // preceding-sibling:: axis - CSS로 변환 불가, 태그만 추출
        const precedingMatch = cssPart.match(/^preceding-sibling::(\w+)/);
        if (precedingMatch) {
          // CSS에서는 preceding을 지원하지 않으므로 스킵
          continue;
        }

        // parent:: axis 처리
        if (cssPart.startsWith('parent::')) {
          // CSS에서 parent selector는 지원하지 않으므로 스킵
          continue;
        }

        // 네임스페이스 제거 (svg:svg -> svg, math:math -> math)
        // 단일 콜론(:)만 처리 - 더블 콜론(::)은 XPath axis이므로 위에서 처리됨
        cssPart = cssPart.replace(/^([\w-]+):(?!:)/, '');

        // contains(@class, '...') 패턴 찾기
        const containsMatch = cssPart.match(/^(\w+)\[contains\(@class,\s*['"]([^'"]+)['"]\)/);
        if (containsMatch) {
          const tag = containsMatch[1];
          const className = containsMatch[2];
          // 클래스명에 특수문자가 있으면 그냥 태그만 사용
          if (/^[\w-]+$/.test(className)) {
            cssPart = `${tag}.${className}`;
          } else {
            cssPart = tag;
          }
        } else if (cssPart.includes('[')) {
          // text()='...' 조건이 있으면 태그만 추출
          const tagMatch = cssPart.match(/^(\w+)\[/);
          if (tagMatch) {
            cssPart = tagMatch[1];
          } else {
            // 다른 조건절 제거
            cssPart = cssPart.replace(/\[.*\]/, '');
          }
        }

        if (cssPart && !cssPart.startsWith('~')) {
          cssSelectors.push(cssPart);
        } else if (cssPart.startsWith('~')) {
          cssSelectors.push(cssPart);
        }
      }

      selector = cssSelectors.join(' ');

      // 5. 연속 공백 정리
      selector = selector.replace(/\s+/g, ' ').trim();

      this.logger.debug(`XPath "${xpathStr}" -> Selector "${selector}"`);
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
    if (!selector) return null;

    const $element = $context.find(selector);
    if ($element.length === 0) {
      const text = $context.text().trim();
      return text || null;
    }

    return $element.first().text().trim() || null;
  }

  private extractAttrFromElement(
    $: CheerioRoot,
    $context: cheerio.Cheerio,
    xpathStr: string,
  ): string | null {
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
}
