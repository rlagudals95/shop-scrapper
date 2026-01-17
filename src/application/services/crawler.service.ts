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
  retryCount: number;
  maxRetries: number;
  lastError?: Error;
  xpathCache?: XPathMap;
  pageType?: PageType;
  cached: boolean;
}

@Injectable()
export class CrawlerService {
  private readonly logger = createLogger(CrawlerService.name);
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(
    @Inject(INJECTION_TOKENS.XPATH_REPOSITORY)
    private readonly xpathRepository: IXPathRepository,
    @Inject(INJECTION_TOKENS.BROWSER_CLIENT)
    private readonly browserClient: IBrowserClient,
    private readonly extractorService: ExtractorService,
    private readonly validatorService: ValidatorService,
    private readonly analyzerService: AnalyzerService,
    private readonly configService: ConfigService,
  ) {
    this.maxRetries = this.configService.get<number>('crawler.maxRetries', 3);
    this.retryDelay = this.configService.get<number>('crawler.retryDelay', 1000);
  }

  async crawl(request: CrawlRequestDto): Promise<CrawlResultDto> {
    const context: CrawlContext = {
      url: request.url,
      domain: extractDomain(request.url),
      retryCount: 0,
      maxRetries: this.maxRetries,
      pageType: request.pageType,
      cached: false,
    };

    this.logger.log(`Starting crawl for: ${request.url}`);

    while (context.retryCount <= context.maxRetries) {
      try {
        const html = await this.browserClient.getPageContent(request.url);

        let xpaths: XPathMap;
        let pageType: PageType;

        if (!request.forceReanalyze && context.retryCount === 0) {
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
          const feedback =
            context.lastError && context.retryCount > 0
              ? this.generateFeedback(context)
              : undefined;

          this.logger.log(`Re-analyzing page (attempt ${context.retryCount + 1})`);
          const analysis = context.pageType
            ? await this.analyzerService.analyzeWithKnownType(
                html,
                context.pageType,
                feedback,
              )
            : await this.analyzerService.analyze(html, feedback);

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
            retryCount: context.retryCount,
            cached: context.cached,
          };
        }

        this.logger.warn(
          `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`,
        );
        context.lastError = new Error(
          this.validatorService.generateRecoveryFeedback(validation),
        );
        context.retryCount++;
        context.cached = false;
        context.pageType = pageType;

        if (context.retryCount <= context.maxRetries) {
          await this.xpathRepository.invalidate(context.domain, pageType);
          await this.sleep(this.retryDelay * context.retryCount);
        }
      } catch (error) {
        context.lastError = error instanceof Error ? error : new Error(String(error));
        context.retryCount++;
        context.cached = false;

        this.logger.error(
          `Crawl attempt ${context.retryCount} failed: ${context.lastError.message}`,
        );

        if (context.retryCount <= context.maxRetries) {
          await this.sleep(this.retryDelay * context.retryCount);
        }
      }
    }

    return {
      success: false,
      url: request.url,
      domain: context.domain,
      error: `Max retries exceeded. Last error: ${context.lastError?.message}`,
      retryCount: context.retryCount,
      cached: false,
    };
  }

  async crawlListing(url: string): Promise<CrawlResultDto> {
    return this.crawl({ url, pageType: PageType.LISTING });
  }

  async crawlPDP(url: string): Promise<CrawlResultDto> {
    return this.crawl({ url, pageType: PageType.PDP });
  }

  private generateFeedback(context: CrawlContext): string {
    if (!context.lastError) return '';
    return context.lastError.message;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
