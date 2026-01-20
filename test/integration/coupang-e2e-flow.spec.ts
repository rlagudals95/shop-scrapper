/**
 * 쿠팡 E2E 크롤링 플로우 테스트
 *
 * 실제 쿠팡 사이트에서:
 * 1. Residential Proxy로 Listing 페이지 크롤링
 * 2. LLM(Gemini)으로 XPath 분석
 * 3. XPath 캐시 저장/조회
 * 4. 데이터 추출 및 검증
 * 5. DB 저장 (crawl_sessions + listing_products)
 *
 * 환경변수 필요:
 * - GEMINI_API_KEY: Gemini API 키
 * - BRIGHT_DATA_API_KEY: Bright Data Residential Proxy 키
 *
 * 실행:
 * GEMINI_API_KEY=xxx BRIGHT_DATA_API_KEY=xxx npm test -- --testPathPattern=coupang-e2e-flow
 */

import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CrawlerService } from '../../src/application/services/crawler.service';
import { INJECTION_TOKENS } from '../../src/common';
import { isListingData, PageType } from '../../src/domain/entities';
import { AnalyzerService } from '../../src/domain/services/analyzer.service';
import { ExtractorService } from '../../src/domain/services/extractor.service';
import { ValidatorService } from '../../src/domain/services/validator.service';
import { GeminiClient } from '../../src/infrastructure/ai/gemini.client';
import configuration from '../../src/infrastructure/config/configuration';
import {
  CrawlSessionOrmEntity,
  ListingProductOrmEntity,
  XPathCacheOrmEntity,
} from '../../src/infrastructure/database/entities';
import { CrawlResultRepository } from '../../src/infrastructure/database/repositories/crawl-result.repository';
import { XPathCacheRepository } from '../../src/infrastructure/database/repositories/xpath-cache.repository';

describe('쿠팡 E2E 크롤링 플로우', () => {
  let module: TestingModule;
  let crawlerService: CrawlerService;
  let xpathRepository: XPathCacheRepository;
  let crawlResultRepository: CrawlResultRepository;

  const hasGeminiKey = !!process.env.GEMINI_API_KEY;
  const hasProxyKey = !!process.env.BRIGHT_DATA_API_KEY;
  const canRunE2E = hasGeminiKey && hasProxyKey;

  beforeAll(async () => {
    if (!canRunE2E) {
      console.warn('\n⚠️  E2E 테스트를 위한 환경변수 미설정');
      if (!hasGeminiKey) console.warn('   - GEMINI_API_KEY 필요');
      if (!hasProxyKey) console.warn('   - BRIGHT_DATA_API_KEY 필요');
      console.warn('\n   실행: GEMINI_API_KEY=xxx BRIGHT_DATA_API_KEY=xxx npm test -- --testPathPattern=coupang-e2e\n');
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
          database: ':memory:', // 테스트용 인메모리 DB
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
        {
          provide: INJECTION_TOKENS.BROWSER_CLIENT,
          useValue: {}, // CrawlerService에서 직접 CoupangBrowserClient 생성
        },
        CrawlerService,
      ],
    }).compile();

    crawlerService = module.get<CrawlerService>(CrawlerService);
    xpathRepository = module.get<XPathCacheRepository>(XPathCacheRepository);
    crawlResultRepository = module.get<CrawlResultRepository>(CrawlResultRepository);
  }, 60000);

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('캐시 미스 → LLM 분석 → DB 저장', () => {
    it('첫 크롤링: XPath 캐시 생성 + DB 저장', async () => {
      if (!canRunE2E) return;

      console.log('\n' + '='.repeat(60));
      console.log('🚀 [테스트 1] 캐시 미스 → LLM 분석 → DB 저장');
      console.log('='.repeat(60));

      // 캐시 초기화
      await xpathRepository.clearAll();

      // 캐시 미스 확인
      const cachedBefore = await xpathRepository.findByDomain('coupang.com', PageType.LISTING);
      console.log(`\n1. 캐시 상태: ${cachedBefore ? '히트' : '미스 (예상)'}`);
      expect(cachedBefore).toBeNull();

      // 크롤링 실행
      console.log('\n2. 크롤링 시작: "헤어밴드"');
      const result = await crawlerService.crawlByKeyword({
        keyword: '헤어밴드',
        site: 'coupang',
      });

      console.log(`\n3. 크롤링 결과:`);
      console.log(`   - 성공: ${result.success}`);
      console.log(`   - URL: ${result.url}`);
      console.log(`   - 캐시 사용: ${result.cached}`);
      console.log(`   - 재시도 횟수: ${result.retryCount}`);

      if (result.success && result.data) {
        // ListingData인지 확인 (타입 가드)
        if (isListingData(result.data)) {
          console.log(`   - 상품 수: ${result.data.products.length}`);
          if (result.data.products.length > 0) {
            console.log(`   - 첫 상품: ${result.data.products[0].name.substring(0, 30)}...`);
          }
        } else {
          console.log(`   - PDP 데이터 추출됨 (상품명: ${result.data.productName || 'N/A'})`);
        }
      } else {
        console.log(`   - 에러: ${result.error}`);
        console.log(`   - 차단 여부: ${result.blocked}`);
      }

      // 성공 검증
      expect(result.success).toBe(true);
      expect(result.cached).toBe(false); // 캐시 미스였으므로
      if (result.data && isListingData(result.data)) {
        expect(result.data.products.length).toBeGreaterThan(0);
      }

      // XPath 캐시 저장 확인
      const cachedAfter = await xpathRepository.findByDomain('coupang.com', PageType.LISTING);
      console.log(`\n4. XPath 캐시 저장: ${cachedAfter ? '✅ 성공' : '❌ 실패'}`);
      expect(cachedAfter).not.toBeNull();
      console.log(`   - productCard: ${cachedAfter?.xpaths.productCard?.substring(0, 50)}...`);

      // DB 저장 확인
      console.log(`\n5. DB 저장 확인:`);
      expect(result.sessionId).toBeDefined();
      console.log(`   - 세션 ID: ${result.sessionId}`);

      const session = await crawlResultRepository.findSessionById(result.sessionId!);
      expect(session).not.toBeNull();
      console.log(`   - 키워드: ${session?.keyword}`);
      console.log(`   - 상품 수: ${session?.productCount}`);
      console.log(`   - 성공 여부: ${session?.success}`);
      expect(session?.products.length).toBeGreaterThan(0);
      console.log(`   - DB 상품 수: ${session?.products.length}`);

      console.log('\n✅ 테스트 1 완료: 캐시 미스 → LLM 분석 → DB 저장 성공');
    }, 300000);
  });

  describe('캐시 히트 → AI 호출 없이 추출', () => {
    it('두 번째 크롤링: XPath 캐시 재사용', async () => {
      if (!canRunE2E) return;

      console.log('\n' + '='.repeat(60));
      console.log('🚀 [테스트 2] 캐시 히트 → AI 호출 없이 추출');
      console.log('='.repeat(60));

      // 캐시 확인 (테스트 1에서 생성됨)
      const cached = await xpathRepository.findByDomain('coupang.com', PageType.LISTING);
      console.log(`\n1. 캐시 상태: ${cached ? '히트 (예상)' : '미스'}`);

      if (!cached) {
        console.log('   ⚠️ 캐시가 없어서 먼저 생성합니다...');
        await crawlerService.crawlByKeyword({ keyword: '테스트', site: 'coupang' });
      }

      // 다른 키워드로 크롤링 (같은 사이트 구조)
      console.log('\n2. 크롤링 시작: "무선이어폰" (다른 키워드, 같은 XPath)');
      const result = await crawlerService.crawlByKeyword({
        keyword: '무선이어폰',
        site: 'coupang',
      });

      console.log(`\n3. 크롤링 결과:`);
      console.log(`   - 성공: ${result.success}`);
      console.log(`   - 캐시 사용: ${result.cached}`);

      if (result.success && result.data) {
        if (isListingData(result.data)) {
          console.log(`   - 상품 수: ${result.data.products.length}`);
        } else {
          console.log(`   - PDP 데이터 추출됨 (상품명: ${result.data.productName || 'N/A'})`);
        }
      }

      // 캐시 히트 검증
      expect(result.success).toBe(true);
      expect(result.cached).toBe(true); // 캐시 히트!
      if (result.data && isListingData(result.data)) {
        expect(result.data.products.length).toBeGreaterThan(0);
      }

      console.log('\n✅ 테스트 2 완료: 캐시 히트 → AI 호출 없이 추출 성공');
    }, 300000);
  });

  describe('강제 재분석 (forceReanalyze)', () => {
    it('캐시가 있어도 강제 재분석 실행', async () => {
      if (!canRunE2E) return;

      console.log('\n' + '='.repeat(60));
      console.log('🚀 [테스트 3] 강제 재분석 (forceReanalyze)');
      console.log('='.repeat(60));

      // 캐시 확인
      const cachedBefore = await xpathRepository.findByDomain('coupang.com', PageType.LISTING);
      console.log(`\n1. 기존 캐시: ${cachedBefore ? '있음' : '없음'}`);

      // 강제 재분석으로 크롤링
      console.log('\n2. 크롤링 시작: "충전기" (forceReanalyze: true)');
      const result = await crawlerService.crawlByKeyword({
        keyword: '충전기',
        site: 'coupang',
        forceReanalyze: true,
      });

      console.log(`\n3. 크롤링 결과:`);
      console.log(`   - 성공: ${result.success}`);
      console.log(`   - 캐시 사용: ${result.cached}`);

      // 강제 재분석이므로 캐시 미사용
      expect(result.cached).toBe(false);

      if (result.success) {
        console.log('\n✅ 테스트 3 완료: 강제 재분석 성공');
      }
    }, 300000);
  });

  describe('최근 세션 조회', () => {
    it('크롤링 히스토리 조회', async () => {
      if (!canRunE2E) return;

      console.log('\n' + '='.repeat(60));
      console.log('🚀 [테스트 4] 최근 세션 조회');
      console.log('='.repeat(60));

      const sessions = await crawlResultRepository.findRecentSessions(5);

      console.log(`\n최근 세션 목록 (${sessions.length}개):`);
      for (const session of sessions) {
        console.log(`  - #${session.id}: "${session.keyword}" (${session.productCount}개 상품, ${session.success ? '성공' : '실패'})`);
      }

      expect(sessions.length).toBeGreaterThan(0);
      console.log('\n✅ 테스트 4 완료: 세션 조회 성공');
    });
  });
});
