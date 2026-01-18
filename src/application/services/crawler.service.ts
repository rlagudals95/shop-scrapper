import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlRequestDto, CrawlResultDto } from '../dto';
import { ExtractorService, ValidatorService, AnalyzerService } from '@/domain/services';
import { IXPathRepository, IBrowserClient } from '@/domain/interfaces';
import { PageType, XPathMap } from '@/domain/entities';
import { INJECTION_TOKENS, extractDomain, createLogger } from '@/common';

interface CrawlContext {
  url: string;
  domain: string;
  pageType?: PageType;
  cached: boolean;
}

@Injectable()
export class CrawlerService {
  private readonly logger = createLogger(CrawlerService.name);

  constructor(
    @Inject(INJECTION_TOKENS.XPATH_REPOSITORY)
    private readonly xpathRepository: IXPathRepository,
    @Inject(INJECTION_TOKENS.BROWSER_CLIENT)
    private readonly browserClient: IBrowserClient,
    private readonly extractorService: ExtractorService,
    private readonly validatorService: ValidatorService,
    private readonly analyzerService: AnalyzerService,
    private readonly configService: ConfigService,
  ) {}

  async crawl(request: CrawlRequestDto): Promise<CrawlResultDto> {
    const context: CrawlContext = {
      url: request.url,
      domain: extractDomain(request.url),
      pageType: request.pageType,
      cached: false,
    };

    this.logger.log(`Starting crawl for: ${request.url}`);

    try {
      // 명시적으로 autoFallback을 활성화하여 HTTP 실패 시 Playwright로 자동 전환
      const html = await this.browserClient.getPageContent(request.url, {
        autoFallback: true,
      });

      let xpaths: XPathMap;
      let pageType: PageType;

      if (!request.forceReanalyze) {
        const cached = context.pageType
          ? await this.xpathRepository.findByDomain(context.domain, context.pageType)
          : null;

        if (cached) {
          this.logger.log(`Using cached XPaths for ${context.domain}`);
          xpaths = cached.xpaths;
          pageType = cached.pageType;
          context.cached = true;
        } else {
          const analysis = context.pageType
            ? await this.analyzerService.analyzeWithKnownType(html, context.pageType)
            : await this.analyzerService.analyze(html);

          xpaths = analysis.xpaths;
          pageType = analysis.pageType;
          await this.xpathRepository.upsert(context.domain, pageType, xpaths);
          this.logger.log(`New XPaths generated and cached for ${context.domain}`);
        }
      } else {
        const analysis = context.pageType
          ? await this.analyzerService.analyzeWithKnownType(html, context.pageType)
          : await this.analyzerService.analyze(html);

        xpaths = analysis.xpaths;
        pageType = analysis.pageType;
        await this.xpathRepository.upsert(context.domain, pageType, xpaths);
      }

      const extractedData = this.extractorService.extract(html, xpaths, pageType);
      const validation = this.validatorService.validate(extractedData, pageType);

      if (validation.isValid) {
        this.logger.log(
          `Crawl successful for ${request.url} (score: ${validation.score})`,
        );
        return {
          success: true,
          url: request.url,
          domain: context.domain,
          pageType,
          data: extractedData,
          retryCount: 0,
          cached: context.cached,
        };
      }

      this.logger.warn(
        `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`,
      );

      return {
        success: false,
        url: request.url,
        domain: context.domain,
        pageType,
        error: this.validatorService.generateRecoveryFeedback(validation),
        retryCount: 0,
        cached: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Crawl failed for ${request.url}: ${errorMessage}`);

      return {
        success: false,
        url: request.url,
        domain: context.domain,
        error: errorMessage,
        retryCount: 0,
        cached: false,
      };
    }
  }

  async crawlListing(url: string): Promise<CrawlResultDto> {
    return this.crawl({ url, pageType: PageType.LISTING });
  }

  async crawlPDP(url: string): Promise<CrawlResultDto> {
    return this.crawl({ url, pageType: PageType.PDP });
  }
}
