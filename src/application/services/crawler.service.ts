import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CrawlRequestDto,
  CrawlResultDto,
  SearchCrawlRequestDto,
  SearchCrawlResultDto,
} from '../dto';
import { ExtractorService, ValidatorService, AnalyzerService } from '@/domain/services';
import { IXPathRepository, IBrowserClient, ISiteBrowserClient, SiteType } from '@/domain/interfaces';
import { PageType, XPathMap } from '@/domain/entities';
import { INJECTION_TOKENS, extractDomain, createLogger } from '@/common';
import { CoupangBrowserClient } from '@/infrastructure/browser';

interface CrawlContext {
  url: string;
  domain: string;
  pageType?: PageType;
  cached: boolean;
}

@Injectable()
export class CrawlerService {
  private readonly logger = createLogger(CrawlerService.name);
  private readonly MAX_RETRY_COUNT = 3;

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

  /**
   * URL 기반 크롤링 (기존 방식)
   */
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

  /**
   * 검색어 기반 Listing 페이지 크롤링
   *
   * 플로우:
   * 1. 사이트별 브라우저 클라이언트 생성
   * 2. 검색어로 Listing 페이지 접근
   * 3. XPath 캐시 확인 또는 AI 분석
   * 4. 데이터 추출 및 검증
   * 5. 실패 시 피드백과 함께 재시도 (최대 3회)
   */
  async crawlByKeyword(request: SearchCrawlRequestDto): Promise<SearchCrawlResultDto> {
    const domain = this.getSiteDomain(request.site);
    this.logger.log(`Starting keyword crawl: "${request.keyword}" on ${request.site}`);

    let siteClient: ISiteBrowserClient | null = null;
    let retryCount = 0;
    let feedback: string | undefined;

    try {
      // 사이트별 클라이언트 생성
      siteClient = await this.createSiteClient(request.site);

      while (retryCount < this.MAX_RETRY_COUNT) {
        try {
          // HTML 가져오기
          const fetchResult = await siteClient.getListingPage(request.keyword);

          if (!fetchResult.success) {
            this.logger.warn(`Page fetch failed: ${fetchResult.error}`);
            return {
              success: false,
              keyword: request.keyword,
              site: request.site,
              url: fetchResult.url,
              error: fetchResult.error,
              retryCount,
              cached: false,
              blocked: fetchResult.blocked,
            };
          }

          const html = fetchResult.html;
          this.logger.log(`Fetched HTML: ${html.length} bytes from ${fetchResult.url}`);

          // XPath 캐시 확인 또는 AI 분석
          let xpaths: XPathMap;
          let cached = false;

          if (!request.forceReanalyze && !feedback) {
            const cachedXPaths = await this.xpathRepository.findByDomain(
              domain,
              PageType.LISTING,
            );

            if (cachedXPaths) {
              this.logger.log(`Using cached XPaths for ${domain}`);
              xpaths = cachedXPaths.xpaths;
              cached = true;
            } else {
              const analysis = await this.analyzerService.analyzeWithKnownType(
                html,
                PageType.LISTING,
                feedback,
              );
              xpaths = analysis.xpaths;
              await this.xpathRepository.upsert(domain, PageType.LISTING, xpaths);
              this.logger.log(`New XPaths generated for ${domain}`);
            }
          } else {
            // 강제 재분석 또는 피드백이 있는 경우
            const analysis = await this.analyzerService.analyzeWithKnownType(
              html,
              PageType.LISTING,
              feedback,
            );
            xpaths = analysis.xpaths;
            await this.xpathRepository.upsert(domain, PageType.LISTING, xpaths);
            this.logger.log(`Re-analyzed XPaths for ${domain} (feedback: ${!!feedback})`);
          }

          // 데이터 추출
          const extractedData = this.extractorService.extract(
            html,
            xpaths,
            PageType.LISTING,
          );

          // 유효성 검증
          const validation = this.validatorService.validate(
            extractedData,
            PageType.LISTING,
          );

          if (validation.isValid) {
            this.logger.log(
              `Crawl successful for "${request.keyword}" (score: ${validation.score})`,
            );
            return {
              success: true,
              keyword: request.keyword,
              site: request.site,
              url: fetchResult.url,
              data: extractedData,
              rawHtml: html,
              retryCount,
              cached,
            };
          }

          // 검증 실패 → 피드백 생성 후 재시도
          feedback = this.validatorService.generateRecoveryFeedback(validation);
          this.logger.warn(
            `Validation failed (attempt ${retryCount + 1}/${this.MAX_RETRY_COUNT}): ${feedback}`,
          );
          retryCount++;
        } catch (innerError) {
          const errorMessage =
            innerError instanceof Error ? innerError.message : String(innerError);
          this.logger.error(`Crawl attempt ${retryCount + 1} failed: ${errorMessage}`);
          retryCount++;

          if (retryCount >= this.MAX_RETRY_COUNT) {
            throw innerError;
          }
        }
      }

      // 최대 재시도 횟수 초과
      return {
        success: false,
        keyword: request.keyword,
        site: request.site,
        url: '',
        error: `Maximum retry count (${this.MAX_RETRY_COUNT}) exceeded. Last feedback: ${feedback}`,
        retryCount,
        cached: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Crawl failed for "${request.keyword}": ${errorMessage}`);

      return {
        success: false,
        keyword: request.keyword,
        site: request.site,
        url: '',
        error: errorMessage,
        retryCount,
        cached: false,
      };
    } finally {
      if (siteClient) {
        await siteClient.close();
      }
    }
  }

  /**
   * URL 기반 Listing 크롤링
   */
  async crawlListing(url: string): Promise<CrawlResultDto> {
    return this.crawl({ url, pageType: PageType.LISTING });
  }

  /**
   * URL 기반 PDP 크롤링
   */
  async crawlPDP(url: string): Promise<CrawlResultDto> {
    return this.crawl({ url, pageType: PageType.PDP });
  }

  /**
   * 쿠팡 검색어 기반 Listing 크롤링 (편의 메서드)
   */
  async crawlCoupangListing(keyword: string): Promise<SearchCrawlResultDto> {
    return this.crawlByKeyword({ keyword, site: 'coupang' });
  }

  // ========== Private Methods ==========

  /**
   * 사이트별 브라우저 클라이언트 생성
   */
  private async createSiteClient(site: SiteType): Promise<ISiteBrowserClient> {
    switch (site) {
      case 'coupang':
        return CoupangBrowserClient.createWithProxy();

      case 'naver':
      case 'naver-brand-store':
      case 'generic':
      default:
        throw new Error(`Site type "${site}" is not yet implemented`);
    }
  }

  /**
   * 사이트 타입에서 도메인 추출
   */
  private getSiteDomain(site: SiteType): string {
    switch (site) {
      case 'coupang':
        return 'coupang.com';
      case 'naver':
        return 'shopping.naver.com';
      case 'naver-brand-store':
        return 'smartstore.naver.com';
      default:
        return 'unknown';
    }
  }
}
