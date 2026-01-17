import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  PageType,
  XPathMap,
  ExtractedData,
  ListingData,
  PDPData,
  ListingXPathMap,
  PDPXPathMap,
} from '../entities';
import { ExtractionException } from '@/common';
import { createLogger } from '@/common';

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

    const productCards = $(this.xpathToSelector(xpaths.productCard));
    this.logger.debug(`Found ${productCards.length} product containers`);

    productCards.each((_: number, element: cheerio.Element) => {
      const $card = $(element);

      const name = this.extractFromElement($, $card, xpaths.name);
      const price = this.extractFromElement($, $card, xpaths.price);
      const url = this.extractAttrFromElement($, $card, xpaths.url);
      const thumbnail = this.extractAttrFromElement($, $card, xpaths.thumbnail);

      if (name || price || url) {
        products.push({
          name: name || '',
          price: price || '',
          url: url || '',
          thumbnail: thumbnail || null,
        });
      }
    });

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
    const selector = xpathStr
      .replace(/^\/\//, '')
      .replace(/^\.\/\//, '')
      .replace(/\[contains\(@class,\s*['"]([^'"]+)['"]\)\]/g, '.$1')
      .replace(/\[@class=['"]([^'"]+)['"]\]/g, '.$1')
      .replace(/\[@id=['"]([^'"]+)['"]\]/g, '#$1')
      .replace(/\[\d+\]/g, '')
      .replace(/\/@\w+$/, '')
      .replace(/\/text\(\)$/, '')
      .replace(/\//g, ' ');

    return selector.trim();
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
