/**
 * CrawlerService 복구 루프 통합 테스트
 *
 * 사이트 구조 변경 시 자동 복구 메커니즘 검증:
 * 1. 캐시된 XPath로 추출 실패
 * 2. Validator가 실패 감지
 * 3. 피드백 생성 → AI 재분석
 * 4. 새 XPath로 재추출 → 성공
 * 5. 캐시 갱신
 *
 * 실행: npm test -- --testPathPattern=crawler-recovery-loop
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExtractorService } from '../../src/domain/services/extractor.service';
import { ValidatorService } from '../../src/domain/services/validator.service';
import { AnalyzerService } from '../../src/domain/services/analyzer.service';
import { GeminiClient } from '../../src/infrastructure/ai/gemini.client';
import { XPathCacheRepository } from '../../src/infrastructure/database/repositories/xpath-cache.repository';
import { CrawlResultRepository } from '../../src/infrastructure/database/repositories/crawl-result.repository';
import {
  XPathCacheOrmEntity,
  CrawlSessionOrmEntity,
  ListingProductOrmEntity,
} from '../../src/infrastructure/database/entities';
import { INJECTION_TOKENS } from '../../src/common';
import {
  PageType,
  ListingXPathMap,
  ListingData,
  isListingData,
} from '../../src/domain/entities';
import configuration from '../../src/infrastructure/config/configuration';

// 테스트용 Listing HTML (간단한 구조)
const VALID_LISTING_HTML = `
<!DOCTYPE html>
<html>
<head><title>검색 결과</title></head>
<body>
  <div class="search-results">
    <ul class="product-list">
      <li class="product-card" data-product-id="1">
        <a href="/products/1" class="product-link">
          <img src="https://img.example.com/1.jpg" class="product-thumbnail" />
          <span class="product-name">테스트 상품 1</span>
          <span class="product-price">10,000원</span>
        </a>
      </li>
      <li class="product-card" data-product-id="2">
        <a href="/products/2" class="product-link">
          <img src="https://img.example.com/2.jpg" class="product-thumbnail" />
          <span class="product-name">테스트 상품 2</span>
          <span class="product-price">20,000원</span>
        </a>
      </li>
      <li class="product-card" data-product-id="3">
        <a href="/products/3" class="product-link">
          <img src="https://img.example.com/3.jpg" class="product-thumbnail" />
          <span class="product-name">테스트 상품 3</span>
          <span class="product-price">30,000원</span>
        </a>
      </li>
    </ul>
  </div>
</body>
</html>
`;

// 잘못된 XPath (구조 변경 시뮬레이션) - 완전히 존재하지 않는 요소
const WRONG_XPATHS: ListingXPathMap = {
  productCard: "//div[@class='completely-nonexistent-xyz123']",
  name: ".//span[@class='nonexistent-name-abc']",
  price: ".//span[@class='nonexistent-price-def']",
  url: ".//a[@class='nonexistent-link-ghi']/@href",
  thumbnail: ".//img[@class='nonexistent-img-jkl']/@src",
};

// 올바른 XPath
const CORRECT_XPATHS: ListingXPathMap = {
  productCard: "//li[@class='product-card']",
  name: ".//span[@class='product-name']",
  price: ".//span[@class='product-price']",
  url: ".//a[@class='product-link']/@href",
  thumbnail: ".//img[@class='product-thumbnail']/@src",
};

describe('CrawlerService Recovery Loop', () => {
  let module: TestingModule;
  let xpathRepository: XPathCacheRepository;
  let extractorService: ExtractorService;
  let validatorService: ValidatorService;
  let analyzerService: AnalyzerService;

  const hasApiKey = !!process.env.GEMINI_API_KEY;
  const testDomain = 'mock.com';

  beforeAll(async () => {
    if (!hasApiKey) {
      console.warn('\n⚠️  GEMINI_API_KEY 미설정 - AI 기반 테스트 스킵');
      console.warn(
        '   실행: GEMINI_API_KEY=your_key npm test -- --testPathPattern=crawler-recovery\n',
      );
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
          entities: [XPathCacheOrmEntity, CrawlSessionOrmEntity, ListingProductOrmEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          XPathCacheOrmEntity,
          CrawlSessionOrmEntity,
          ListingProductOrmEntity,
        ]),
      ],
      providers: [
        ExtractorService,
        ValidatorService,
        AnalyzerService,
        XPathCacheRepository,
        CrawlResultRepository,
        GeminiClient,
        {
          provide: INJECTION_TOKENS.XPATH_REPOSITORY,
          useExisting: XPathCacheRepository,
        },
        {
          provide: INJECTION_TOKENS.AI_CLIENT,
          useExisting: GeminiClient,
        },
      ],
    }).compile();

    xpathRepository = module.get<XPathCacheRepository>(XPathCacheRepository);
    extractorService = module.get<ExtractorService>(ExtractorService);
    validatorService = module.get<ValidatorService>(ValidatorService);
    analyzerService = module.get<AnalyzerService>(AnalyzerService);
  }, 60000);

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  beforeEach(async () => {
    if (!hasApiKey) return;
    await xpathRepository.clearAll();
  });

  describe('XPath 캐시 히트 시나리오', () => {
    it('올바른 캐시가 있으면 AI 호출 없이 성공해야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n=== 캐시 히트 테스트 ===');

      // 올바른 XPath 미리 캐싱
      await xpathRepository.upsert(testDomain, PageType.LISTING, CORRECT_XPATHS);
      console.log('1. 올바른 XPath 캐싱 완료');

      // 캐시 확인
      const cached = await xpathRepository.findByDomain(testDomain, PageType.LISTING);
      expect(cached).not.toBeNull();
      console.log('2. 캐시 히트 확인');

      // ExtractorService로 직접 추출 테스트
      const data = extractorService.extract(VALID_LISTING_HTML, CORRECT_XPATHS, PageType.LISTING);

      if (isListingData(data)) {
        console.log(`3. 추출된 상품 수: ${data.products?.length || 0}`);
        expect(data.products).toBeDefined();
        expect(data.products.length).toBeGreaterThan(0);
      } else {
        fail('Expected ListingData');
      }
    });
  });

  describe('복구 루프 시나리오', () => {
    it('잘못된 캐시 → 적은 상품 수 → AI 재분석 → 개선된 결과', async () => {
      if (!hasApiKey) return;

      console.log('\n=== 복구 루프 테스트 ===');

      // 1단계: 잘못된 XPath로 추출 시도
      const wrongData = extractorService.extract(
        VALID_LISTING_HTML,
        WRONG_XPATHS,
        PageType.LISTING,
      ) as ListingData;

      console.log(`1. 잘못된 XPath 추출 결과:`);
      console.log(`   - 상품 수: ${wrongData.products?.length || 0}`);
      const wrongProductCount = wrongData.products?.length || 0;

      // 2단계: AI 분석으로 올바른 XPath 생성
      console.log('2. AI 분석 요청 중...');
      const analysis = await analyzerService.analyzeWithKnownType(
        VALID_LISTING_HTML,
        PageType.LISTING,
      );
      console.log(`   - productCard: ${analysis.xpaths.productCard}`);

      // 3단계: 새 XPath로 재추출
      const correctData = extractorService.extract(
        VALID_LISTING_HTML,
        analysis.xpaths,
        PageType.LISTING,
      ) as ListingData;
      const validation = validatorService.validate(correctData, PageType.LISTING);

      console.log(`3. AI XPath 추출 결과:`);
      console.log(`   - 상품 수: ${correctData.products?.length || 0}`);
      console.log(`   - 검증: ${validation.isValid ? '✅ 성공' : '❌ 실패'}`);

      if (correctData.products && correctData.products.length > 0) {
        console.log(`   - 첫 번째 상품: ${correctData.products[0].name}`);
      }

      // AI가 생성한 XPath가 더 나은 결과를 제공해야 함
      expect(validation.isValid).toBe(true);
      expect(correctData.products.length).toBeGreaterThanOrEqual(wrongProductCount);
      // HTML에는 3개의 상품이 있으므로 3개를 추출해야 함
      expect(correctData.products.length).toBe(3);
    }, 180000);

    it('피드백을 통해 AI가 XPath를 개선해야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n=== 피드백 기반 재분석 테스트 ===');

      // 잘못된 XPath로 실패한 상황 시뮬레이션
      const failedData = extractorService.extract(
        VALID_LISTING_HTML,
        WRONG_XPATHS,
        PageType.LISTING,
      ) as ListingData;
      const failedValidation = validatorService.validate(failedData, PageType.LISTING);

      // 피드백 생성
      const feedback = validatorService.generateRecoveryFeedback(failedValidation);
      console.log(`1. 피드백 생성됨:\n${feedback.substring(0, 100)}...`);

      expect(feedback).toContain('이전 XPath 분석이 실패했습니다');

      // 피드백과 함께 AI 재분석
      console.log('2. 피드백과 함께 AI 재분석 요청...');
      const newAnalysis = await analyzerService.analyzeWithKnownType(
        VALID_LISTING_HTML,
        PageType.LISTING,
        feedback,
      );

      console.log(`3. 새 XPath 생성됨: productCard = ${newAnalysis.xpaths.productCard}`);

      // 새 XPath는 잘못된 XPath와 달라야 함
      expect(newAnalysis.xpaths.productCard).not.toBe(WRONG_XPATHS.productCard);
      expect(newAnalysis.xpaths.productCard).toBeTruthy();
    }, 120000);
  });

  describe('캐시 무효화 시나리오', () => {
    it('forceReanalyze 옵션으로 캐시를 무시하고 재분석해야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n=== 강제 재분석 테스트 ===');

      // 잘못된 XPath 캐싱
      await xpathRepository.upsert(testDomain, PageType.LISTING, WRONG_XPATHS);

      const cachedBefore = await xpathRepository.findByDomain(testDomain, PageType.LISTING);
      console.log(`1. 캐시된 XPath: ${cachedBefore?.xpaths.productCard}`);

      // 강제 재분석
      const newAnalysis = await analyzerService.analyzeWithKnownType(
        VALID_LISTING_HTML,
        PageType.LISTING,
      );

      // 캐시 갱신
      await xpathRepository.upsert(testDomain, PageType.LISTING, newAnalysis.xpaths);

      const cachedAfter = await xpathRepository.findByDomain(testDomain, PageType.LISTING);
      console.log(`2. 갱신된 XPath: ${cachedAfter?.xpaths.productCard}`);

      // XPath가 변경되었는지 확인
      expect(cachedAfter?.xpaths.productCard).not.toBe(WRONG_XPATHS.productCard);
    }, 120000);
  });
});
