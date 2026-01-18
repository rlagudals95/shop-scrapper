/**
 * Real AI Pipeline Integration Tests
 *
 * 실제 Gemini AI를 호출하여 전체 파이프라인을 테스트합니다.
 * URL만 주면 AI가 HTML을 분석하고 XPath를 추론하여 데이터를 추출합니다.
 *
 * 실행 방법:
 * GEMINI_API_KEY=your_key npm run test:integration -- --testPathPattern=real-ai-pipeline
 *
 * Pipeline Flow:
 * 1. URL → HTTP/Playwright로 HTML 가져오기
 * 2. HTML → Gemini AI가 페이지 타입 분석
 * 3. HTML → Gemini AI가 XPath 추론/생성
 * 4. XPath로 실제 데이터 추출
 * 5. 추출된 데이터 검증
 * 6. XPath 캐시 저장/조회
 */

import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';
import { CrawlerService } from '../../src/application/services/crawler.service';
import { INJECTION_TOKENS } from '../../src/common';
import { ListingData, PageType, PDPData } from '../../src/domain/entities';
import { AnalyzerService } from '../../src/domain/services/analyzer.service';
import { ExtractorService } from '../../src/domain/services/extractor.service';
import { ValidatorService } from '../../src/domain/services/validator.service';
import { GeminiClient } from '../../src/infrastructure/ai/gemini.client';
import { PlaywrightClient } from '../../src/infrastructure/browser/playwright.client';
import configuration from '../../src/infrastructure/config/configuration';
import { XPathCacheOrmEntity } from '../../src/infrastructure/database/entities/xpath-cache.orm-entity';
import { XPathCacheRepository } from '../../src/infrastructure/database/repositories/xpath-cache.repository';
dotenv.config();

// Test URLs
const TEST_URLS = {
  naver: {
    pdp: 'https://smartstore.naver.com/k_mall1/products/11591756016',
    listing: 'https://search.shopping.naver.com/search/all?query=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C',
  },
  coupang: {
    listing: 'https://www.coupang.com/np/search?component=&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C',
  },
};

describe('Real AI Pipeline Integration Tests', () => {
  let module: TestingModule;
  let crawlerService: CrawlerService;
  let analyzerService: AnalyzerService;
  let extractorService: ExtractorService;
  let validatorService: ValidatorService;
  let browserClient: PlaywrightClient;
  let repository: XPathCacheRepository;

  const hasApiKey = !!process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    if (!hasApiKey) {
      console.warn('\n⚠️  GEMINI_API_KEY not set - skipping real AI tests');
      console.warn('   Run with: GEMINI_API_KEY=your_key npm run test:integration\n');
      return;
    }

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [XPathCacheOrmEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([XPathCacheOrmEntity]),
      ],
      providers: [
        CrawlerService,
        AnalyzerService,
        ExtractorService,
        ValidatorService,
        XPathCacheRepository,
        GeminiClient,
        PlaywrightClient,
        {
          provide: INJECTION_TOKENS.XPATH_REPOSITORY,
          useExisting: XPathCacheRepository,
        },
        {
          provide: INJECTION_TOKENS.BROWSER_CLIENT,
          useExisting: PlaywrightClient,
        },
        {
          provide: INJECTION_TOKENS.AI_CLIENT,
          useExisting: GeminiClient,
        },
      ],
    }).compile();

    crawlerService = module.get<CrawlerService>(CrawlerService);
    analyzerService = module.get<AnalyzerService>(AnalyzerService);
    extractorService = module.get<ExtractorService>(ExtractorService);
    validatorService = module.get<ValidatorService>(ValidatorService);
    browserClient = module.get<PlaywrightClient>(PlaywrightClient);
    repository = module.get<XPathCacheRepository>(XPathCacheRepository);
  }, 60000);

  afterAll(async () => {
    try {
      if (browserClient) {
        await Promise.race([
          browserClient.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browser close timeout')), 10000),
          ),
        ]).catch((error) => {
          console.warn(`Failed to close browser: ${error}`);
        });
        // 추가 대기 시간으로 프로세스 완전 종료 보장
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.warn(`Error in afterAll browser cleanup: ${error}`);
    }

    try {
      if (module) {
        await module.close();
      }
    } catch (error) {
      console.warn(`Error closing module: ${error}`);
    }
  }, 30000);

  beforeEach(async () => {
    if (!hasApiKey) return;
    await repository.clearAll();
  });

  // ============================================
  // Step 1: HTML 가져오기 테스트
  // ============================================
  describe('Step 1: HTML Fetch', () => {
    it('should fetch HTML from Naver Smartstore', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.pdp;
      console.log('\n📥 Step 1: Fetching HTML');
      console.log(`   URL: ${url}`);

      const result = await browserClient.getPageContentWithInfo(url);

      console.log(`   ✅ Fetched ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);

      // HTML 내용 일부 출력 (보안 확인 페이지인지 확인)
      console.log(`\n   HTML Preview (first 1500 chars):`);
      console.log(result.html.substring(0, 1500));

      // 보안 확인 페이지인지 체크
      const isSecurityPage = result.html.includes('security verification') ||
                             result.html.includes('captcha') ||
                             result.html.includes('보안 확인');
      console.log(`\n   Is Security/Blocked Page: ${isSecurityPage}`);

      // 상품 페이지 핵심 요소 존재 여부
      const hasProductInfo = result.html.includes('상품명') ||
                             result.html.includes('price') ||
                             result.html.includes('productName');
      console.log(`   Has Product Info: ${hasProductInfo}`);

      expect(result.html.length).toBeGreaterThan(1000);
      expect(result.html).toContain('<!DOCTYPE html>');
    }, 60000);

    it('should fetch HTML from Coupang Listing', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.coupang.listing;
      console.log('\n📥 Step 1-B: Fetching HTML from Coupang');
      console.log(`   URL: ${url}`);

      const result = await browserClient.getPageContentWithInfo(url);

      console.log(`   ✅ Fetched ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);
      console.log(`   Blocked: ${result.blocked || false}`);

      // HTML 내용 일부 출력
      console.log(`\n   HTML Preview (first 1500 chars):`);
      console.log(result.html.substring(0, 1500));

      // 보안 확인 페이지인지 체크
      const isSecurityPage = result.blocked ||
                             result.html.includes('security verification') ||
                             result.html.includes('captcha') ||
                             result.html.includes('보안 확인') ||
                             result.html.includes('Access Denied');
      console.log(`\n   Is Security/Blocked Page: ${isSecurityPage}`);

      // 봇 차단된 경우 테스트 스킵 (문서화 목적)
      if (result.blocked || isSecurityPage) {
        console.log(`   ⚠️ Coupang blocked the request (Akamai WAF)`);
        console.log(`   💡 This is expected - Coupang has strong bot detection`);
        // 차단된 경우에도 기본 HTML 구조는 확인
        expect(result.html.length).toBeGreaterThan(0);
        return; // 테스트 종료 (실패하지 않음)
      }

      // 상품 페이지 핵심 요소 존재 여부
      const hasProductInfo = result.html.includes('product') ||
                             result.html.includes('search-product') ||
                             result.html.includes('price');
      console.log(`   Has Product Info: ${hasProductInfo}`);

      // 차단되지 않은 경우에만 상세 검증
      expect(result.html.length).toBeGreaterThan(1000);
      expect(result.html).toContain('<!DOCTYPE html>');
    }, 60000);
  });

  // ============================================
  // Step 2: AI 페이지 타입 분석 테스트
  // ============================================
  describe('Step 2: AI Page Type Analysis', () => {
    it('should detect PDP page type using real AI', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.pdp;
      console.log('\n🔍 Step 2: AI Page Type Analysis');
      console.log(`   URL: ${url}`);

      // Fetch HTML
      const html = await browserClient.getPageContent(url);
      console.log(`   HTML fetched: ${html.length} bytes`);

      // Analyze with AI
      const result = await analyzerService.analyze(html);

      console.log(`   ✅ Page Type: ${result.pageType}`);
      console.log(`   Confidence: ${result.confidence}`);

      expect(result.pageType).toBe(PageType.PDP);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    }, 120000);
  });

  // ============================================
  // Step 3: AI XPath 추론 테스트
  // ============================================
  describe('Step 3: AI XPath Generation', () => {
    it('should generate XPaths for PDP using real AI', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.pdp;
      console.log('\n🎯 Step 3: AI XPath Generation');
      console.log(`   URL: ${url}`);

      // Fetch HTML
      const html = await browserClient.getPageContent(url);

      // Analyze with known type (skip page type detection)
      const result = await analyzerService.analyzeWithKnownType(html, PageType.PDP);

      console.log(`   ✅ Generated XPaths:`);
      console.log(`   - productName: ${result.xpaths.productName}`);
      console.log(`   - price: ${result.xpaths.price}`);
      console.log(`   - brandName: ${result.xpaths.brandName || 'N/A'}`);

      expect(result.xpaths).toBeDefined();
      expect(result.xpaths.productName).toBeDefined();
      expect(result.xpaths.price).toBeDefined();
    }, 120000);
  });

  // ============================================
  // Step 4: 데이터 추출 테스트
  // ============================================
  describe('Step 4: Data Extraction', () => {
    it('should extract product data using AI-generated XPaths', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.pdp;
      console.log('\n📦 Step 4: Data Extraction');
      console.log(`   URL: ${url}`);

      // Fetch HTML
      const html = await browserClient.getPageContent(url);

      // AI generates XPaths
      const analysis = await analyzerService.analyzeWithKnownType(html, PageType.PDP);
      console.log(`   AI XPaths generated`);

      // Extract data using XPaths
      const extractedData = extractorService.extract(
        html,
        analysis.xpaths,
        PageType.PDP,
      ) as PDPData;

      console.log(`\n   ✅ Extracted Data:`);
      console.log(`   - Product Name: ${extractedData.productName}`);
      console.log(`   - Price: ${extractedData.price}`);
      console.log(`   - Brand: ${extractedData.brandName || 'N/A'}`);
      console.log(`   - Description: ${extractedData.description?.substring(0, 50) || 'N/A'}...`);
      console.log(`   - Options: ${extractedData.options?.length || 0} items`);
      console.log(`   - Images: ${extractedData.detailImages?.length || 0} items`);

      // Validate
      const validation = validatorService.validate(extractedData, PageType.PDP);
      console.log(`\n   Validation: ${validation.isValid ? '✅ PASS' : '❌ FAIL'}`);
      if (!validation.isValid) {
        console.log(`   Errors: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      expect(extractedData.productName).toBeTruthy();
      expect(extractedData.price).toBeTruthy();
    }, 120000);
  });

  // ============================================
  // Step 5: 캐시 테스트
  // ============================================
  describe('Step 5: XPath Caching', () => {
    it('should cache and retrieve XPaths', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.pdp;
      const domain = 'smartstore.naver.com';
      console.log('\n💾 Step 5: XPath Caching');

      // First crawl - should generate new XPaths
      console.log('   First crawl (generating XPaths)...');
      const result1 = await crawlerService.crawlPDP(url);

      expect(result1.cached).toBe(false);
      console.log(`   ✅ First crawl: cached=${result1.cached}`);

      // Check cache was saved
      const cached = await repository.findByDomain(domain, PageType.PDP);
      expect(cached).not.toBeNull();
      console.log(`   ✅ XPaths saved to cache`);
      console.log(`   Cached XPaths: ${Object.keys(cached?.xpaths || {}).join(', ')}`);

      // Second crawl - should use cached XPaths
      console.log('\n   Second crawl (using cache)...');
      const result2 = await crawlerService.crawlPDP(url);

      expect(result2.cached).toBe(true);
      console.log(`   ✅ Second crawl: cached=${result2.cached}`);
    }, 180000);
  });

  // ============================================
  // Full Pipeline Test
  // ============================================
  describe('Full Pipeline: URL → Data', () => {
    it('should complete full pipeline for Naver PDP', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.pdp;
      console.log('\n🚀 FULL PIPELINE TEST');
      console.log('='.repeat(50));
      console.log(`Input URL: ${url}`);
      console.log('='.repeat(50));

      // Execute full pipeline
      const result = await crawlerService.crawlPDP(url);

      console.log('\n📊 PIPELINE RESULTS:');
      console.log(`   Success: ${result.success}`);
      console.log(`   Page Type: ${result.pageType}`);
      console.log(`   Cached: ${result.cached}`);
      console.log(`   Retry Count: ${result.retryCount}`);

      if (result.success && result.data && 'productName' in result.data) {
        const data = result.data as PDPData;
        console.log('\n📦 EXTRACTED DATA:');
        console.log(`   Product: ${data.productName}`);
        console.log(`   Price: ${data.price}`);
        console.log(`   Brand: ${data.brandName || 'N/A'}`);
        console.log(`   Options: ${data.options?.length || 0}`);
        console.log(`   Images: ${data.detailImages?.length || 0}`);
      }

      if (result.error) {
        console.log(`\n❌ Error: ${result.error}`);
      }

      console.log('\n' + '='.repeat(50));

      expect(result.success).toBe(true);
      expect(result.pageType).toBe(PageType.PDP);
      if (result.data && 'productName' in result.data) {
        expect(result.data.productName).toBeTruthy();
        expect(result.data.price).toBeTruthy();
      }
    }, 180000);

    it('should complete full pipeline for Naver Listing', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.listing;
      console.log('\n🚀 FULL PIPELINE TEST (LISTING)');
      console.log('='.repeat(50));
      console.log(`Input URL: ${url.substring(0, 60)}...`);
      console.log('='.repeat(50));

      // Execute full pipeline
      const result = await crawlerService.crawlListing(url);

      console.log('\n📊 PIPELINE RESULTS:');
      console.log(`   Success: ${result.success}`);
      console.log(`   Page Type: ${result.pageType}`);
      console.log(`   Cached: ${result.cached}`);

      if (result.success && result.data && 'products' in result.data) {
        const data = result.data as ListingData;
        console.log(`\n📦 EXTRACTED ${data.products.length} PRODUCTS:`);
        data.products.slice(0, 5).forEach((p, i) => {
          console.log(`   ${i + 1}. ${p.name?.substring(0, 40) || 'N/A'}...`);
          console.log(`      Price: ${p.price}`);
        });
      }

      if (result.error) {
        console.log(`\n❌ Error: ${result.error}`);
      }

      console.log('\n' + '='.repeat(50));

      expect(result.pageType).toBe(PageType.LISTING);
    }, 180000);
  });

  // ============================================
  // Save Results to File
  // ============================================
  describe('Save Results', () => {
    it('should save extraction results to data folder', async () => {
      if (!hasApiKey) return;

      const url = TEST_URLS.naver.pdp;
      const result = await crawlerService.crawlPDP(url);

      if (result.success && result.data) {
        const dataDir = path.join(__dirname, '../../..', 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }

        const outputPath = path.join(dataDir, 'last-extraction-result.json');
        fs.writeFileSync(
          outputPath,
          JSON.stringify(
            {
              url,
              timestamp: new Date().toISOString(),
              pageType: result.pageType,
              cached: result.cached,
              data: result.data,
            },
            null,
            2,
          ),
        );

        console.log(`\n💾 Results saved to: ${outputPath}`);
      }
    }, 180000);
  });
});
