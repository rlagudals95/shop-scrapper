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
import { PageType, XPathMap, ListingData } from '@/domain/entities';
import { INJECTION_TOKENS, extractDomain, createLogger } from '@/common';
import { CoupangBrowserClient } from '@/infrastructure/browser';
import { CrawlResultRepository } from '@/infrastructure/database/repositories/crawl-result.repository';

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
    private readonly crawlResultRepository: CrawlResultRepository,
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

      // URL에서 origin 추출하여 상대 URL 정규화에 사용
      const baseUrl = this.extractBaseUrl(request.url);
      const extractedData = this.extractorService.extract(html, xpaths, pageType, { baseUrl });
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
   * 검색어 기반 Listing 크롤링 + DB 저장
   *
   * 플로우:
   * 1. 사이트별 브라우저 클라이언트 생성
   * 2. 검색어로 Listing 페이지 접근
   * 3. XPath 캐시 확인 → 추출 → **품질 검증**
   * 4. 캐시 검증 실패 시 → **캐시 무효화** + 피드백 생성
   * 5. LLM으로 새 XPath 생성 (최대 2회 재시도)
   * 6. 성공 시 → **캐시 저장** + DB 저장
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

      // HTML 가져오기 (루프 밖에서 한 번만)
      const fetchResult = await siteClient.getListingPage(request.keyword);

      if (!fetchResult.success) {
        this.logger.warn(`Page fetch failed: ${fetchResult.error}`);

        // 실패 세션 저장
        await this.crawlResultRepository.saveFailedSession(
          request.site,
          request.keyword,
          fetchResult.error || 'Unknown error',
        );

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
      const baseUrl = this.extractBaseUrl(fetchResult.url);
      this.logger.log(`Fetched HTML: ${html.length} bytes from ${fetchResult.url}`);

      // === 1. 캐시 확인 및 품질 검증 ===
      if (!request.forceReanalyze) {
        const cachedXPaths = await this.xpathRepository.findByDomain(
          domain,
          PageType.LISTING,
        );

        if (cachedXPaths) {
          this.logger.log(`Testing cached XPaths for ${domain}`);

          // 캐시된 XPath로 추출
          const extractedData = this.extractorService.extract(
            html,
            cachedXPaths.xpaths,
            PageType.LISTING,
            { baseUrl },
          ) as ListingData;

          // 품질 검증
          const quality = this.extractorService.evaluateExtractionQuality(extractedData);

          if (this.extractorService.isQualityAcceptable(quality)) {
            // 캐시 검증 성공 → 바로 반환
            this.logger.log(
              `Cache validation passed: ${quality.validProducts}/${quality.totalProducts} valid, ${quality.priceValidProducts} with valid price`,
            );

            // DB 저장
            const { session } = await this.crawlResultRepository.saveListingResult(
              request.site,
              request.keyword,
              fetchResult.url,
              html,
              extractedData,
            );

            return {
              success: true,
              keyword: request.keyword,
              site: request.site,
              url: fetchResult.url,
              data: extractedData,
              rawHtml: html,
              retryCount: 0,
              cached: true,
              sessionId: session.id,
            };
          }

          // 캐시 검증 실패 → 캐시 무효화 + 피드백 생성
          this.logger.warn(
            `Cache validation failed: ${quality.validProducts}/${quality.totalProducts} valid (${quality.qualityScore}%), ${quality.priceValidProducts} with valid price`,
          );
          await this.xpathRepository.invalidate(domain, PageType.LISTING);
          feedback = this.validatorService.generateQualityFeedback(quality, cachedXPaths.xpaths);
          this.logger.log(`Cache invalidated for ${domain}, will regenerate XPaths`);
        }
      }

      // === 2. LLM으로 XPath 생성 (재시도 루프) ===
      while (retryCount < this.MAX_RETRY_COUNT) {
        try {
          // LLM 분석
          const analysis = await this.analyzerService.analyzeWithKnownType(
            html,
            PageType.LISTING,
            feedback,
          );
          const xpaths = analysis.xpaths;
          this.logger.log(`Generated XPaths (attempt ${retryCount + 1}): ${JSON.stringify(xpaths)}`);

          // 데이터 추출
          const extractedData = this.extractorService.extract(
            html,
            xpaths,
            PageType.LISTING,
            { baseUrl },
          ) as ListingData;

          // 품질 검증
          const quality = this.extractorService.evaluateExtractionQuality(extractedData);

          if (this.extractorService.isQualityAcceptable(quality)) {
            // 성공 → 캐시 저장
            await this.xpathRepository.upsert(domain, PageType.LISTING, xpaths);
            this.logger.log(
              `XPath generation success (attempt ${retryCount + 1}): ${quality.validProducts}/${quality.totalProducts} valid`,
            );

            // 기존 검증도 실행
            const validation = this.validatorService.validate(extractedData, PageType.LISTING);

            // DB 저장
            const { session, products } = await this.crawlResultRepository.saveListingResult(
              request.site,
              request.keyword,
              fetchResult.url,
              html,
              extractedData,
            );

            this.logger.log(
              `Saved to DB: session #${session.id}, ${products.length} products (score: ${validation.score})`,
            );

            return {
              success: true,
              keyword: request.keyword,
              site: request.site,
              url: fetchResult.url,
              data: extractedData,
              rawHtml: html,
              retryCount,
              cached: false,
              sessionId: session.id,
            };
          }

          // 품질 미달 → 피드백 생성 후 재시도
          feedback = this.validatorService.generateQualityFeedback(quality, xpaths);
          this.logger.warn(
            `Quality check failed (attempt ${retryCount + 1}/${this.MAX_RETRY_COUNT}): ${quality.qualityScore}% valid, ${quality.priceValidProducts} valid prices`,
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
      await this.crawlResultRepository.saveFailedSession(
        request.site,
        request.keyword,
        `Maximum retry count (${this.MAX_RETRY_COUNT}) exceeded. Last feedback: ${feedback}`,
      );

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

      // 실패 세션 저장
      await this.crawlResultRepository.saveFailedSession(
        request.site,
        request.keyword,
        errorMessage,
      );

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

  /**
   * 세션 조회
   */
  async getSession(sessionId: number) {
    return this.crawlResultRepository.findSessionById(sessionId);
  }

  /**
   * 최근 세션 목록 조회
   */
  async getRecentSessions(limit: number = 10) {
    return this.crawlResultRepository.findRecentSessions(limit);
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

  /**
   * URL에서 origin (baseUrl) 추출
   * 상대 URL을 절대 URL로 변환할 때 사용
   */
  private extractBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.origin;
    } catch {
      return '';
    }
  }
}
