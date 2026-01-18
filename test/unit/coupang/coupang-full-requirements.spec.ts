/**
 * 쿠팡 Fixture 기반 전체 요구사항 테스트
 *
 * REQUIREMENTS.md의 모든 기능 요구사항을 HTML fixture로 검증합니다.
 * (페이지 가져오기 제외)
 *
 * 테스트 항목:
 * 1. 페이지 타입 인식 (Page Type Recognition)
 * 2. AI XPath 생성 (XPath Generation)
 * 3. 데이터 추출 (Data Extraction)
 * 4. 유효성 검증 (Validation)
 * 5. XPath 캐싱 (Smart Caching)
 * 6. 복구 루프 (Recovery Loop)
 *
 * 실행: npm run test:unit -- --testPathPattern=coupang-full-requirements
 */

import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { INJECTION_TOKENS } from '../../../src/common';
import {
  PageType,
  PDPData,
  PDPXPathMap,
} from '../../../src/domain/entities';
import { AnalyzerService } from '../../../src/domain/services/analyzer.service';
import { ExtractorService } from '../../../src/domain/services/extractor.service';
import { ValidatorService } from '../../../src/domain/services/validator.service';
import { GeminiClient } from '../../../src/infrastructure/ai/gemini.client';
import configuration from '../../../src/infrastructure/config/configuration';
import { XPathCacheOrmEntity } from '../../../src/infrastructure/database/entities/xpath-cache.orm-entity';
import { XPathCacheRepository } from '../../../src/infrastructure/database/repositories/xpath-cache.repository';

// Fixture paths
const COUPANG_PDP_HTML = path.join(__dirname, '../../fixtures/coupang/html/pdp.html');

// 기대값 (HTML에서 확인된 실제 데이터)
const EXPECTED_PDP_DATA = {
  productName: '써머텍트 기능성 헤어밴드',
  brand: '써머텍트',
  prices: ['10630', '10,630', '15000', '15,000'],
};

describe('쿠팡 전체 요구사항 테스트 (Coupang Full Requirements)', () => {
  let module: TestingModule;
  let analyzerService: AnalyzerService;
  let extractorService: ExtractorService;
  let validatorService: ValidatorService;
  let xpathRepository: XPathCacheRepository;
  let html: string;

  const hasApiKey = !!process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    if (!hasApiKey) {
      console.warn('\n⚠️  GEMINI_API_KEY 미설정 - 실제 AI 테스트 스킵');
      console.warn('   실행: GEMINI_API_KEY=your_key npm run test:unit\n');
      return;
    }

    // HTML fixture 로드
    html = fs.readFileSync(COUPANG_PDP_HTML, 'utf-8');
    console.log(`\n📂 Fixture 로드: ${html.length.toLocaleString()} bytes\n`);

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
        AnalyzerService,
        ExtractorService,
        ValidatorService,
        XPathCacheRepository,
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

    analyzerService = module.get<AnalyzerService>(AnalyzerService);
    extractorService = module.get<ExtractorService>(ExtractorService);
    validatorService = module.get<ValidatorService>(ValidatorService);
    xpathRepository = module.get<XPathCacheRepository>(XPathCacheRepository);
  }, 60000);

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  // ============================================
  // 1. 페이지 타입 인식 (Page Type Recognition)
  // REQUIREMENTS: Listing/PDP 구분
  // ============================================
  describe('1. 페이지 타입 인식', () => {
    it('PDP 페이지를 정확히 인식해야 함', async () => {
      if (!hasApiKey) return;

      console.log('🔍 [1] 페이지 타입 인식 테스트');

      const result = await analyzerService.analyze(html);

      console.log(`   페이지 타입: ${result.pageType}`);
      console.log(`   신뢰도: ${result.confidence}`);

      expect(result.pageType).toBe(PageType.PDP);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    }, 60000);
  });

  // ============================================
  // 2. AI XPath 생성 (XPath Generation)
  // REQUIREMENTS: 각 필드별 XPath 자동 생성
  // ============================================
  describe('2. AI XPath 생성', () => {
    it('PDP 필수 필드에 대한 XPath를 생성해야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n🎯 [2] AI XPath 생성 테스트');

      const result = await analyzerService.analyzeWithKnownType(html, PageType.PDP);

      console.log(`   생성된 XPath 필드:`);
      console.log(`   - productName: ${result.xpaths.productName ? '✅' : '❌'}`);
      console.log(`   - price: ${result.xpaths.price ? '✅' : '❌'}`);
      console.log(`   - brandName: ${result.xpaths.brandName ? '✅' : '⚠️ (optional)'}`);
      console.log(`   - description: ${result.xpaths.description ? '✅' : '⚠️ (optional)'}`);

      // 필수 필드 XPath 존재 확인
      expect(result.xpaths.productName).toBeTruthy();
      expect(result.xpaths.price).toBeTruthy();
    }, 120000);

    it('생성된 XPath가 유효한 형식이어야 함', async () => {
      if (!hasApiKey) return;

      const result = await analyzerService.analyzeWithKnownType(html, PageType.PDP);

      // XPath 형식 검증 (// 또는 .// 로 시작)
      const xpaths = result.xpaths as PDPXPathMap;

      if (xpaths.productName) {
        expect(xpaths.productName).toMatch(/^(\/\/|\.\/\/)/);
      }
      if (xpaths.price) {
        expect(xpaths.price).toMatch(/^(\/\/|\.\/\/)/);
      }
    }, 120000);
  });

  // ============================================
  // 3. 데이터 추출 (Data Extraction)
  // REQUIREMENTS: 상품명, 가격, 브랜드, 설명, 옵션, 이미지
  // ============================================
  describe('3. 데이터 추출', () => {
    it('AI 생성 XPath로 PDP 데이터를 추출해야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n📦 [3] 데이터 추출 테스트');

      // XPath 생성
      const analysis = await analyzerService.analyzeWithKnownType(html, PageType.PDP);

      // 데이터 추출
      const data = extractorService.extract(
        html,
        analysis.xpaths,
        PageType.PDP,
      ) as PDPData;

      console.log(`   추출된 데이터:`);
      console.log(`   - 상품명: ${data.productName || '❌ NULL'}`);
      console.log(`   - 가격: ${data.price || '❌ NULL'}`);
      console.log(`   - 브랜드: ${data.brandName || '(없음)'}`);
      console.log(`   - 설명: ${data.description ? data.description.substring(0, 30) + '...' : '(없음)'}`);
      console.log(`   - 옵션: ${data.options?.length || 0}개`);
      console.log(`   - 상세이미지: ${data.detailImages?.length || 0}개`);

      // 필수 필드 추출 확인
      expect(data.productName).toBeTruthy();
      expect(data.price).toBeTruthy();
    }, 120000);

    it('추출된 데이터가 기대값과 일치해야 함', async () => {
      if (!hasApiKey) return;

      const analysis = await analyzerService.analyzeWithKnownType(html, PageType.PDP);
      const data = extractorService.extract(html, analysis.xpaths, PageType.PDP) as PDPData;

      // 상품명 검증
      const productNameMatch =
        data.productName?.includes('써머텍트') ||
        data.productName?.includes('헤어밴드');

      // 가격 검증 (숫자 추출)
      const priceNumbers = data.price?.replace(/[^0-9]/g, '') || '';
      const priceMatch =
        priceNumbers.includes('10630') ||
        priceNumbers.includes('15000') ||
        data.price?.includes('원');

      console.log(`\n   기대값 검증:`);
      console.log(`   - 상품명 매치: ${productNameMatch ? '✅' : '❌'}`);
      console.log(`   - 가격 매치: ${priceMatch ? '✅' : '❌'}`);

      expect(productNameMatch).toBe(true);
      expect(priceMatch).toBe(true);
    }, 120000);
  });

  // ============================================
  // 4. 유효성 검증 (Validation)
  // REQUIREMENTS: 필수 데이터 누락, 패턴 불일치 감지
  // ============================================
  describe('4. 유효성 검증', () => {
    it('유효한 데이터는 검증 통과해야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n✅ [4] 유효성 검증 테스트');

      const analysis = await analyzerService.analyzeWithKnownType(html, PageType.PDP);
      const data = extractorService.extract(html, analysis.xpaths, PageType.PDP) as PDPData;
      const validation = validatorService.validate(data, PageType.PDP);

      console.log(`   검증 결과: ${validation.isValid ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   품질 점수: ${validation.score}/100`);
      console.log(`   에러 수: ${validation.errors.length}`);
      console.log(`   경고 수: ${validation.warnings.length}`);

      if (!validation.isValid) {
        console.log(`   에러 내용: ${validation.errors.map((e) => e.message).join(', ')}`);
      }

      expect(validation.isValid).toBe(true);
      expect(validation.score).toBeGreaterThanOrEqual(50);
    }, 120000);

    it('필수 필드 누락 시 검증 실패해야 함', () => {
      if (!hasApiKey) return;

      // 빈 데이터로 검증
      const emptyData: PDPData = {
        productName: '',
        price: '',
        brandName: null,
        description: null,
        options: [],
        detailImages: [],
      };

      const validation = validatorService.validate(emptyData, PageType.PDP);

      console.log(`\n   빈 데이터 검증: ${validation.isValid ? '⚠️ 통과됨' : '✅ 실패 (정상)'}`);
      console.log(`   에러: ${validation.errors.map((e) => e.field).join(', ')}`);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('가격 패턴 불일치 시 에러 감지해야 함', () => {
      if (!hasApiKey) return;

      const invalidData: PDPData = {
        productName: '테스트 상품',
        price: 'invalid-price', // 숫자가 없는 가격
        brandName: null,
        description: null,
        options: [],
        detailImages: [],
      };

      const validation = validatorService.validate(invalidData, PageType.PDP);

      console.log(`   잘못된 가격 검증: ${validation.isValid ? '⚠️' : '✅ 에러 감지'}`);

      expect(validation.isValid).toBe(false);
    });
  });

  // ============================================
  // 5. XPath 캐싱 (Smart Caching)
  // REQUIREMENTS: 캐시 확인, 저장, 갱신
  // ============================================
  describe('5. XPath 캐싱', () => {
    const testDomain = 'coupang.com';

    beforeEach(async () => {
      if (!hasApiKey) return;
      await xpathRepository.clearAll();
    });

    it('XPath를 저장하고 조회할 수 있어야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n💾 [5] XPath 캐싱 테스트');

      const xpaths: PDPXPathMap = {
        productName: "//h1[@class='product-title']",
        price: "//span[@class='price']",
        brandName: "//span[@class='brand']",
      };

      // 저장
      await xpathRepository.upsert(testDomain, PageType.PDP, xpaths);
      console.log(`   저장 완료: ${testDomain} (PDP)`);

      // 조회
      const cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);

      console.log(`   조회 결과: ${cached ? '✅ 캐시 히트' : '❌ 캐시 미스'}`);

      expect(cached).not.toBeNull();
      expect(cached!.xpaths).toEqual(xpaths);
    });

    it('캐시 갱신이 정상 동작해야 함', async () => {
      if (!hasApiKey) return;

      const oldXpaths: PDPXPathMap = {
        productName: "//h1[@class='old-title']",
        price: "//span[@class='old-price']",
      };

      const newXpaths: PDPXPathMap = {
        productName: "//h1[@class='new-title']",
        price: "//span[@class='new-price']",
      };

      // 첫 번째 저장
      await xpathRepository.upsert(testDomain, PageType.PDP, oldXpaths);

      // 갱신
      await xpathRepository.upsert(testDomain, PageType.PDP, newXpaths);

      // 확인
      const cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);

      console.log(`   갱신 후 XPath: ${cached?.xpaths.productName}`);

      expect(cached!.xpaths.productName).toBe(newXpaths.productName);
    });

    it('캐시 무효화가 정상 동작해야 함', async () => {
      if (!hasApiKey) return;

      const xpaths: PDPXPathMap = {
        productName: "//h1",
        price: "//span",
      };

      await xpathRepository.upsert(testDomain, PageType.PDP, xpaths);

      // 무효화
      await xpathRepository.invalidate(testDomain, PageType.PDP);

      const cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);

      console.log(`   무효화 후: ${cached ? '⚠️ 캐시 존재' : '✅ 캐시 삭제됨'}`);

      expect(cached).toBeNull();
    });

    it('실제 AI 생성 XPath를 캐싱할 수 있어야 함', async () => {
      if (!hasApiKey) return;

      // AI로 XPath 생성
      const analysis = await analyzerService.analyzeWithKnownType(html, PageType.PDP);

      // 캐시 저장
      await xpathRepository.upsert(testDomain, PageType.PDP, analysis.xpaths);

      // 캐시 조회
      const cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);

      console.log(`   AI XPath 캐싱: ${cached ? '✅' : '❌'}`);

      expect(cached).not.toBeNull();
      expect(cached!.xpaths.productName).toBe(analysis.xpaths.productName);
    }, 120000);
  });

  // ============================================
  // 6. 복구 루프 (Recovery Loop)
  // REQUIREMENTS: 실패 시 AI 재분석, 캐시 갱신
  // ============================================
  describe('6. 복구 루프', () => {
    const testDomain = 'coupang-recovery.com';

    beforeEach(async () => {
      if (!hasApiKey) return;
      await xpathRepository.clearAll();
    });

    it('잘못된 XPath로 추출 실패 시 재분석해야 함', async () => {
      if (!hasApiKey) return;

      console.log('\n🔄 [6] 복구 루프 테스트');

      // 1단계: 잘못된 XPath 캐싱
      const wrongXpaths: PDPXPathMap = {
        productName: "//div[@class='non-existent-class']",
        price: "//span[@class='wrong-price']",
      };

      await xpathRepository.upsert(testDomain, PageType.PDP, wrongXpaths);
      console.log(`   1단계: 잘못된 XPath 캐싱`);

      // 2단계: 캐시된 XPath로 추출 시도
      let cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);
      let data = extractorService.extract(html, cached!.xpaths, PageType.PDP) as PDPData;
      let validation = validatorService.validate(data, PageType.PDP);

      console.log(`   2단계: 추출 시도 → ${validation.isValid ? '성공' : '❌ 실패 (예상)'}`);
      expect(validation.isValid).toBe(false);

      // 3단계: 복구 - 캐시 무효화 및 AI 재분석
      console.log(`   3단계: 복구 시작 (캐시 무효화 + AI 재분석)`);
      await xpathRepository.invalidate(testDomain, PageType.PDP);

      const newAnalysis = await analyzerService.analyzeWithKnownType(html, PageType.PDP);
      await xpathRepository.upsert(testDomain, PageType.PDP, newAnalysis.xpaths);

      // 4단계: 새 XPath로 재추출
      cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);
      data = extractorService.extract(html, cached!.xpaths, PageType.PDP) as PDPData;
      validation = validatorService.validate(data, PageType.PDP);

      console.log(`   4단계: 재추출 → ${validation.isValid ? '✅ 성공' : '❌ 실패'}`);
      console.log(`   복구된 상품명: ${data.productName}`);

      expect(validation.isValid).toBe(true);
    }, 180000);

    it('피드백 기반 재분석이 동작해야 함', async () => {
      if (!hasApiKey) return;

      // 실패 피드백 생성
      const feedback = `이전 XPath 분석이 실패했습니다. 다음 문제를 수정해주세요:

- productName: Required field is empty
- price: Required field is empty

새로운 XPath를 생성할 때 위 필드들에 특히 주의해주세요.`;

      console.log(`\n   피드백 기반 재분석 테스트`);

      // 피드백과 함께 재분석
      const result = await analyzerService.analyzeWithKnownType(
        html,
        PageType.PDP,
        feedback,
      );

      // 재분석 결과 검증
      const data = extractorService.extract(html, result.xpaths, PageType.PDP) as PDPData;
      const validation = validatorService.validate(data, PageType.PDP);

      console.log(`   피드백 후 결과: ${validation.isValid ? '✅ 성공' : '❌ 실패'}`);

      expect(result.xpaths.productName).toBeTruthy();
      expect(result.xpaths.price).toBeTruthy();
    }, 120000);
  });

  // ============================================
  // 전체 파이프라인 통합 테스트
  // ============================================
  describe('전체 파이프라인 (End-to-End)', () => {
    it('캐시 미스 → AI 분석 → 추출 → 검증 → 캐시 저장', async () => {
      if (!hasApiKey) return;

      console.log('\n' + '='.repeat(50));
      console.log('🚀 전체 파이프라인 테스트');
      console.log('='.repeat(50));

      const testDomain = 'coupang-e2e.com';
      await xpathRepository.clearAll();

      // Step 1: 캐시 확인 (미스 예상)
      let cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);
      console.log(`\n📌 Step 1: 캐시 확인 → ${cached ? '히트' : '미스'}`);
      expect(cached).toBeNull();

      // Step 2: AI 페이지 분석
      console.log(`📌 Step 2: AI 페이지 분석 중...`);
      const analysis = await analyzerService.analyze(html);
      console.log(`   → 페이지 타입: ${analysis.pageType}, 신뢰도: ${analysis.confidence}`);
      expect(analysis.pageType).toBe(PageType.PDP);

      // Step 3: 캐시 저장
      console.log(`📌 Step 3: XPath 캐시 저장`);
      await xpathRepository.upsert(testDomain, analysis.pageType, analysis.xpaths);

      // Step 4: 데이터 추출
      console.log(`📌 Step 4: 데이터 추출`);
      const data = extractorService.extract(html, analysis.xpaths, analysis.pageType) as PDPData;
      console.log(`   → 상품명: ${data.productName}`);
      console.log(`   → 가격: ${data.price}`);

      // Step 5: 유효성 검증
      console.log(`📌 Step 5: 유효성 검증`);
      const validation = validatorService.validate(data, analysis.pageType);
      console.log(`   → 결과: ${validation.isValid ? '✅ PASS' : '❌ FAIL'} (점수: ${validation.score})`);

      // Step 6: 캐시 재확인 (히트 예상)
      cached = await xpathRepository.findByDomain(testDomain, PageType.PDP);
      console.log(`📌 Step 6: 캐시 재확인 → ${cached ? '✅ 히트' : '미스'}`);

      console.log('\n' + '='.repeat(50));
      console.log('✅ 전체 파이프라인 완료');
      console.log('='.repeat(50));

      expect(validation.isValid).toBe(true);
      expect(cached).not.toBeNull();
    }, 180000);
  });
});
