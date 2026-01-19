import { Injectable, Inject } from '@nestjs/common';
import { PageType, XPathMap } from '../entities';
import { IAiClient } from '@/domain/interfaces';
import { INJECTION_TOKENS, AnalysisException, createLogger } from '@/common';
import {
  buildPageTypePrompt,
  buildListingXPathPrompt,
  buildPDPXPathPrompt,
} from '@/infrastructure/ai/prompts';

export interface AnalyzerResult {
  pageType: PageType;
  xpaths: XPathMap;
  confidence: number;
  rawResponse?: string;
}

interface PageTypeResponse {
  pageType: 'LISTING' | 'PDP';
  confidence: number;
  reasoning: string;
}

@Injectable()
export class AnalyzerService {
  private readonly logger = createLogger(AnalyzerService.name);

  constructor(
    @Inject(INJECTION_TOKENS.AI_CLIENT)
    private readonly aiClient: IAiClient,
  ) {}

  async analyze(html: string, feedback?: string): Promise<AnalyzerResult> {
    const simplifiedHtml = this.simplifyHtml(html);
    this.logger.debug(`Simplified HTML length: ${simplifiedHtml.length}`);

    const pageType = await this.detectPageType(simplifiedHtml);
    this.logger.log(`Detected page type: ${pageType.pageType} (confidence: ${pageType.confidence})`);

    if (pageType.confidence < 0.7) {
      throw new AnalysisException(
        `Page type detection confidence too low: ${pageType.confidence}`,
      );
    }

    const xpaths = await this.generateXPaths(
      simplifiedHtml,
      pageType.pageType === 'LISTING' ? PageType.LISTING : PageType.PDP,
      feedback,
    );

    return {
      pageType: pageType.pageType === 'LISTING' ? PageType.LISTING : PageType.PDP,
      xpaths,
      confidence: pageType.confidence,
    };
  }

  async analyzeWithKnownType(
    html: string,
    pageType: PageType,
    feedback?: string,
  ): Promise<AnalyzerResult> {
    const simplifiedHtml = this.simplifyHtml(html);
    const xpaths = await this.generateXPaths(simplifiedHtml, pageType, feedback);

    return {
      pageType,
      xpaths,
      confidence: 1.0,
    };
  }

  private async detectPageType(html: string): Promise<PageTypeResponse> {
    const prompt = buildPageTypePrompt(html);
    const response = await this.aiClient.generate(prompt);

    try {
      const parsed = this.parseJsonResponse<PageTypeResponse>(response.content);
      return {
        pageType: parsed.pageType,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      throw new AnalysisException(
        `Failed to parse page type response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async generateXPaths(
    html: string,
    pageType: PageType,
    feedback?: string,
  ): Promise<XPathMap> {
    const prompt =
      pageType === PageType.LISTING
        ? buildListingXPathPrompt(html, feedback)
        : buildPDPXPathPrompt(html, feedback);

    const response = await this.aiClient.generate(prompt);
    this.logger.log(`AI Raw Response: ${response.content}`);

    try {
      const rawResponse = this.parseJsonResponse<Record<string, unknown>>(response.content);
      const xpaths = this.normalizeXPathResponse(rawResponse, pageType);
      this.logger.log(`Generated XPaths: ${JSON.stringify(xpaths, null, 2)}`);
      return xpaths;
    } catch (error) {
      this.logger.error(`Failed to parse AI response: ${response.content.substring(0, 1000)}`);
      throw new AnalysisException(
        `Failed to parse XPath response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * LLM 응답을 표준 XPathMap 형식으로 변환
   * CSS 셀렉터 형식: { productCard, fields: { name: { selectors: [...], attribute: ... } } }
   * XPath 형식: { productCard, fields: { name: { xpaths: [...] } } }
   * 기존 형식: { productCard, name, price, url, thumbnail }
   */
  private normalizeXPathResponse(raw: Record<string, unknown>, pageType: PageType): XPathMap {
    // 이미 기존 형식인 경우 (name이 string)
    if (typeof raw.name === 'string' || typeof raw.productName === 'string') {
      return raw as XPathMap;
    }

    // 새 형식 (fields 중첩 구조)
    if (raw.fields && typeof raw.fields === 'object') {
      const fields = raw.fields as Record<string, {
        xpaths?: string[];
        selectors?: string[];
        attribute?: string | null;
        fallbackAttributes?: string[];
        confidence?: number;
      }>;

      // CSS 셀렉터 또는 XPath에서 값 추출 (여러 셀렉터를 ,로 연결)
      const getSelector = (field?: {
        xpaths?: string[];
        selectors?: string[];
        attribute?: string | null;
      }): string | undefined => {
        // CSS 셀렉터 형식 우선
        if (field?.selectors && field.selectors.length > 0) {
          // 여러 셀렉터를 CSS OR 연산자(,)로 연결
          // 예: "[class*='priceValue'], [class*='salePrice']"
          const combinedSelector = field.selectors.join(', ');
          // 속성 추출이 필요한 경우 (href, src 등) 마커 추가
          if (field.attribute) {
            return `${combinedSelector}/@${field.attribute}`;
          }
          return combinedSelector;
        }
        // XPath 형식
        const xpath = field?.xpaths?.[0];
        return xpath && xpath.length > 0 ? xpath : undefined;
      };

      if (pageType === PageType.LISTING) {
        return {
          productCard: raw.productCard as string,
          name: getSelector(fields.name),
          price: getSelector(fields.price),
          url: getSelector(fields.url),
          thumbnail: getSelector(fields.thumbnail),
        };
      } else {
        // PDP
        const pdpFields = raw as Record<string, { xpaths?: string[]; selectors?: string[]; confidence?: number }>;
        return {
          productName: getSelector(pdpFields.productName),
          price: getSelector(pdpFields.price),
          brandName: getSelector(pdpFields.brandName),
          description: getSelector(pdpFields.description),
          options: getSelector(pdpFields.options),
          detailImages: getSelector(pdpFields.detailImages),
        };
      }
    }

    // 알 수 없는 형식
    this.logger.warn(`Unknown XPath response format: ${JSON.stringify(raw).substring(0, 500)}`);
    return raw as XPathMap;
  }

  private parseJsonResponse<T>(response: string): T {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    const jsonBlockMatch = response.match(/\{[\s\S]*\}/);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[0]);
    }

    throw new Error('No valid JSON found in response');
  }

  private simplifyHtml(html: string): string {
    let simplified = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><');

    const preserveAttrs = ['class', 'id', 'href', 'src', 'data-src', 'alt', 'title', 'data-product', 'data-item'];
    const attrPattern = new RegExp(
      `\\s+(?!(?:${preserveAttrs.join('|')})=)[a-z-]+="[^"]*"`,
      'gi',
    );
    simplified = simplified.replace(attrPattern, '');

    const maxLength = 100000;
    if (simplified.length > maxLength) {
      const bodyMatch = simplified.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) {
        simplified = bodyMatch[1];
      }

      if (simplified.length > maxLength) {
        simplified = simplified.substring(0, maxLength);
      }
    }

    return simplified.trim();
  }
}
