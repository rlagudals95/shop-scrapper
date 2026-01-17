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

    try {
      const xpaths = this.parseJsonResponse<XPathMap>(response.content);
      this.logger.debug(`Generated XPaths: ${JSON.stringify(xpaths)}`);
      return xpaths;
    } catch (error) {
      throw new AnalysisException(
        `Failed to parse XPath response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
