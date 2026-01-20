/**
 * PDP Selector 추출 단위 테스트
 *
 * HTML fixture를 사용하여 LLM의 PDP 셀렉터 추출 능력을 검증
 * - HTML 필터링 성능 테스트
 * - 셀렉터 생성 정확도 테스트
 * - 데이터 추출 검증
 * - 품질 기반 캐싱 테스트
 *
 * 환경변수 필요: GEMINI_API_KEY
 *
 * 실행:
 * GEMINI_API_KEY=xxx npm test -- --testPathPattern=pdp-selector-extraction
 */

import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnalyzerService } from '../../../src/domain/services/analyzer.service';
import { ExtractorService, PDPExtractionQuality } from '../../../src/domain/services/extractor.service';
import { ValidatorService } from '../../../src/domain/services/validator.service';
import { HtmlFilterService } from '../../../src/domain/services/html-filter.service';
import { GeminiClient } from '../../../src/infrastructure/ai/gemini.client';
import { SelectorCacheRepository } from '../../../src/infrastructure/database/repositories/selector-cache.repository';
import {
  SelectorCacheOrmEntity,
  CrawlSessionOrmEntity,
  ListingProductOrmEntity,
} from '../../../src/infrastructure/database/entities';
import { INJECTION_TOKENS } from '../../../src/common';
import { PageType, PDPData, PDPSelectorMap, isPDPData } from '../../../src/domain/entities';
import configuration from '../../../src/infrastructure/config/configuration';

// 테스트 fixture 경로 설정
const FIXTURES_PATH = path.join(__dirname, '../../fixtures');
const OUTPUT_PATH = path.join(__dirname, '../../../data/extracted');

// JSON 저장 헬퍼 함수
function savePDPExtractionResult(
  storeName: string,
  data: PDPData,
  selectors?: PDPSelectorMap,
  quality?: PDPExtractionQuality,
) {
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.mkdirSync(OUTPUT_PATH, { recursive: true });
  }

  const result = {
    store: storeName,
    extractedAt: new Date().toISOString(),
    selectors: selectors || null,
    quality: quality || null,
    data,
  };

  const filePath = path.join(OUTPUT_PATH, `${storeName}-pdp-test.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`  JSON 저장됨: ${filePath}`);
}

interface PDPFixture {
  name: string;
  domain: string;
  pdpHtmlPath: string;
  /** 기대되는 필수 필드 */
  expectedRequiredFields: string[];
  /** 기대되는 선택 필드 */
  expectedOptionalFields: string[];
}

// 스토어별 PDP fixture 정의
const PDP_FIXTURES: PDPFixture[] = [
  {
    name: 'coupang',
    domain: 'coupang.com',
    pdpHtmlPath: path.join(FIXTURES_PATH, 'coupang/html/pdp.html'),
    expectedRequiredFields: ['productName', 'price'],
    expectedOptionalFields: ['brandName', 'description', 'options', 'detailImages'],
  },
  {
    name: 'naver',
    domain: 'smartstore.naver.com',
    pdpHtmlPath: path.join(FIXTURES_PATH, 'naver/html/pdp.html'),
    expectedRequiredFields: ['productName', 'price'],
    expectedOptionalFields: ['brandName', 'description', 'options', 'detailImages'],
  },
];

describe('PDP Selector Extraction', () => {
  let module: TestingModule;
  let analyzerService: AnalyzerService;
  let extractorService: ExtractorService;
  let validatorService: ValidatorService;
  let htmlFilterService: HtmlFilterService;
  let selectorRepository: SelectorCacheRepository;

  const hasApiKey = !!process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    if (!hasApiKey) {
      console.warn('\n⚠️  GEMINI_API_KEY 미설정 - AI 기반 테스트 스킵');
      console.warn(
        '   실행: GEMINI_API_KEY=your_key npm test -- --testPathPattern=pdp-selector-extraction\n',
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
          entities: [SelectorCacheOrmEntity, CrawlSessionOrmEntity, ListingProductOrmEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          SelectorCacheOrmEntity,
          CrawlSessionOrmEntity,
          ListingProductOrmEntity,
        ]),
      ],
      providers: [
        AnalyzerService,
        ExtractorService,
        ValidatorService,
        HtmlFilterService,
        SelectorCacheRepository,
        GeminiClient,
        {
          provide: INJECTION_TOKENS.XPATH_REPOSITORY,
          useExisting: SelectorCacheRepository,
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
    htmlFilterService = module.get<HtmlFilterService>(HtmlFilterService);
    selectorRepository = module.get<SelectorCacheRepository>(SelectorCacheRepository);
  }, 60000);

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  beforeEach(async () => {
    if (!hasApiKey) return;
    await selectorRepository.clearAll();
  });

  describe('HTML 필터링 성능', () => {
    it.each(
      PDP_FIXTURES.filter((f) => fs.existsSync(f.pdpHtmlPath)),
    )('$name: PDP HTML 필터링으로 토큰 절감', async (fixture) => {
      if (!hasApiKey) return;

      console.log(`\n=== ${fixture.name} PDP HTML 필터링 테스트 ===`);

      const rawHtml = fs.readFileSync(fixture.pdpHtmlPath, 'utf-8');
      console.log(`원본 HTML 크기: ${(rawHtml.length / 1024).toFixed(1)}KB`);

      const filtered = htmlFilterService.filterForPDP(rawHtml);

      console.log(`필터링된 HTML 크기: ${(filtered.filteredLength / 1024).toFixed(1)}KB`);
      console.log(`압축률: ${filtered.compressionRatio}%`);

      if (filtered.jsonLd) {
        console.log(`JSON-LD 추출됨: ${JSON.stringify(filtered.jsonLd).substring(0, 200)}...`);
      }

      // 최소 30% 이상 압축되어야 함 (PDP는 Listing보다 컨텐츠가 많음)
      expect(filtered.compressionRatio).toBeGreaterThanOrEqual(30);
      // 100KB 이하로 줄어야 LLM 토큰 효율적
      expect(filtered.filteredLength).toBeLessThanOrEqual(100000);
    });
  });

  describe('쿠팡 PDP Selector 추출', () => {
    const coupangFixture = PDP_FIXTURES.find((f) => f.name === 'coupang');

    beforeAll(() => {
      if (!coupangFixture || !fs.existsSync(coupangFixture.pdpHtmlPath)) {
        console.warn('쿠팡 PDP fixture 파일 없음');
      }
    });

    it('LLM이 쿠팡 PDP에서 필수 필드(productName, price)를 추출해야 함', async () => {
      if (!hasApiKey || !coupangFixture || !fs.existsSync(coupangFixture.pdpHtmlPath)) {
        return;
      }

      console.log('\n=== 쿠팡 PDP Selector 추출 테스트 ===');

      // 1. HTML 로드 및 필터링
      const rawHtml = fs.readFileSync(coupangFixture.pdpHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForPDP(rawHtml);

      console.log(`1. HTML 필터링 완료: ${rawHtml.length} → ${filtered.filteredLength} bytes`);

      // 2. LLM으로 Selector 분석
      console.log('2. LLM Selector 분석 중...');
      const analysis = await analyzerService.analyzeWithKnownType(
        filtered.html,
        PageType.PDP,
      );

      console.log('3. 생성된 Selector:');
      console.log(JSON.stringify(analysis.selectors, null, 2));

      // 3. Selector 필수 필드 검증
      const selectors = analysis.selectors as PDPSelectorMap;
      expect(selectors.productName).toBeDefined();
      expect(selectors.price).toBeDefined();

      console.log(`   - productName: ${selectors.productName}`);
      console.log(`   - price: ${selectors.price}`);
      console.log(`   - brandName: ${selectors.brandName || '(없음)'}`);
      console.log(`   - description: ${selectors.description || '(없음)'}`);
      console.log(`   - options: ${selectors.options || '(없음)'}`);
      console.log(`   - detailImages: ${selectors.detailImages || '(없음)'}`);

      // 4. Selector로 데이터 추출
      console.log('4. 데이터 추출 테스트...');
      const extracted = extractorService.extract(rawHtml, selectors, PageType.PDP);

      if (isPDPData(extracted)) {
        console.log(`   추출된 데이터:`);
        console.log(`     - 상품명: ${extracted.productName?.substring(0, 50)}...`);
        console.log(`     - 가격: ${extracted.price}`);
        console.log(`     - 브랜드: ${extracted.brandName || '(없음)'}`);
        console.log(`     - 설명 길이: ${extracted.description?.length || 0}자`);
        console.log(`     - 옵션 수: ${extracted.options?.length || 0}`);
        console.log(`     - 상세이미지 수: ${extracted.detailImages?.length || 0}`);

        // 품질 평가
        const quality = extractorService.evaluatePDPQuality(extracted);
        console.log(`   품질 평가:`);
        console.log(`     - 품질 점수: ${quality.qualityScore}`);
        console.log(`     - productName: ${quality.hasProductName ? '✅' : '❌'}`);
        console.log(`     - price: ${quality.hasPrice ? '✅' : '❌'}`);
        console.log(`     - brandName: ${quality.hasBrandName ? '✅' : '⚠️'}`);
        console.log(`     - description: ${quality.hasDescription ? '✅' : '⚠️'}`);

        // JSON 파일로 저장
        savePDPExtractionResult('coupang', extracted, selectors, quality);

        // 필수 필드 검증
        expect(quality.hasProductName).toBe(true);
        expect(quality.hasPrice).toBe(true);
        expect(quality.qualityScore).toBeGreaterThanOrEqual(60);
      } else {
        fail('PDPData가 아님');
      }

      // 5. Validation 검증
      console.log('5. Validation 검증...');
      const validation = validatorService.validate(extracted, PageType.PDP);
      console.log(`   - isValid: ${validation.isValid}`);
      console.log(`   - score: ${validation.score}%`);
      console.log(`   - errors: ${validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ')}`);

      expect(validation.isValid).toBe(true);
    }, 180000);

    it('품질 기준 충족 시 캐시 저장 및 재사용', async () => {
      if (!hasApiKey || !coupangFixture || !fs.existsSync(coupangFixture.pdpHtmlPath)) {
        return;
      }

      console.log('\n=== PDP 캐시 테스트 (품질 검증 포함) ===');

      const rawHtml = fs.readFileSync(coupangFixture.pdpHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForPDP(rawHtml);

      // 1. Selector 생성
      console.log('1. LLM으로 Selector 생성 중...');
      const analysis = await analyzerService.analyzeWithKnownType(
        filtered.html,
        PageType.PDP,
      );
      console.log(`   생성된 Selector: ${JSON.stringify(analysis.selectors, null, 2)}`);

      // 2. 추출 및 품질 검증 (캐시 저장 전)
      const extracted = extractorService.extract(rawHtml, analysis.selectors, PageType.PDP);

      expect(isPDPData(extracted)).toBe(true);
      if (!isPDPData(extracted)) return;

      const quality = extractorService.evaluatePDPQuality(extracted);
      console.log(`2. 품질 검증:`);
      console.log(`   - 품질 점수: ${quality.qualityScore}`);
      console.log(`   - productName: ${quality.hasProductName ? '✅' : '❌'}`);
      console.log(`   - price: ${quality.hasPrice ? '✅' : '❌'}`);

      // 3. 품질 기준 충족 시에만 캐시 저장
      const isAcceptable = extractorService.isPDPQualityAcceptable(quality);
      if (isAcceptable) {
        await selectorRepository.upsert(
          coupangFixture.domain,
          PageType.PDP,
          analysis.selectors,
        );
        console.log(`3. 품질 기준 충족 (${quality.qualityScore}점) → 캐시 저장 완료`);
      } else {
        console.log(`3. 품질 기준 미달 (${quality.qualityScore}점) → 캐시 저장 안함`);
      }

      // 4. 캐시 조회
      const cached = await selectorRepository.findByDomain(
        coupangFixture.domain,
        PageType.PDP,
      );

      if (cached) {
        console.log(`4. 캐시 조회 성공`);

        // 5. 캐시된 Selector로 다시 추출
        const cachedExtracted = extractorService.extract(rawHtml, cached.selectors, PageType.PDP);

        if (isPDPData(cachedExtracted)) {
          const cachedQuality = extractorService.evaluatePDPQuality(cachedExtracted);
          console.log(`5. 캐시된 Selector로 추출:`);
          console.log(`   - 상품명: ${cachedExtracted.productName?.substring(0, 30)}...`);
          console.log(`   - 품질: ${cachedQuality.qualityScore}점`);

          // JSON 파일로 저장
          savePDPExtractionResult('coupang-cached', cachedExtracted, cached.selectors as PDPSelectorMap, cachedQuality);

          // 캐시된 Selector도 동일한 품질을 유지해야 함
          expect(cachedQuality.qualityScore).toBeGreaterThanOrEqual(60);
        }
      } else {
        console.log(`4. 캐시 없음 (품질 미달로 저장 안됨)`);
      }

      // 최소 품질 기준 검증
      expect(quality.qualityScore).toBeGreaterThanOrEqual(60);

      // 품질 기준 충족 시 캐시가 저장되어 있어야 함
      if (isAcceptable) {
        expect(cached).not.toBeNull();
        expect(cached!.selectors.productName).toBeDefined();
      }
    }, 180000);
  });

  describe('네이버 PDP Selector 추출', () => {
    const naverFixture = PDP_FIXTURES.find((f) => f.name === 'naver');

    it('LLM이 네이버 스마트스토어 PDP에서 필드를 추출해야 함', async () => {
      if (!hasApiKey || !naverFixture || !fs.existsSync(naverFixture.pdpHtmlPath)) {
        console.log('네이버 PDP fixture 없음 - 스킵');
        return;
      }

      console.log('\n=== 네이버 PDP Selector 추출 테스트 ===');

      const rawHtml = fs.readFileSync(naverFixture.pdpHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForPDP(rawHtml);

      console.log(`HTML 필터링: ${rawHtml.length} → ${filtered.filteredLength} bytes`);

      const analysis = await analyzerService.analyzeWithKnownType(
        filtered.html,
        PageType.PDP,
      );

      console.log('생성된 Selector:', JSON.stringify(analysis.selectors, null, 2));

      const selectors = analysis.selectors as PDPSelectorMap;
      expect(selectors.productName).toBeDefined();

      const extracted = extractorService.extract(rawHtml, selectors, PageType.PDP);

      if (isPDPData(extracted)) {
        console.log(`추출된 데이터:`);
        console.log(`  - 상품명: ${extracted.productName?.substring(0, 50)}...`);
        console.log(`  - 가격: ${extracted.price}`);

        // 품질 평가
        const quality = extractorService.evaluatePDPQuality(extracted);
        console.log(`품질 평가:`);
        console.log(`  - 품질 점수: ${quality.qualityScore}`);
        console.log(`  - productName: ${quality.hasProductName ? '✅' : '❌'}`);
        console.log(`  - price: ${quality.hasPrice ? '✅' : '❌'}`);

        // JSON 파일로 저장
        savePDPExtractionResult('naver', extracted, selectors, quality);

        // 품질 기준 충족 시 캐시 저장
        if (extractorService.isPDPQualityAcceptable(quality)) {
          await selectorRepository.upsert(naverFixture.domain, PageType.PDP, selectors);
          console.log(`캐시 저장 완료: ${naverFixture.domain}`);
        } else {
          console.log(`⚠️ 품질 미달 (${quality.qualityScore}점) - 캐시 저장 안함`);
        }

        // 필수 필드가 추출되어야 함
        expect(quality.hasProductName).toBe(true);
      }
    }, 180000);
  });

  describe('복구 루프 테스트', () => {
    const coupangFixture = PDP_FIXTURES.find((f) => f.name === 'coupang');

    it('잘못된 셀렉터로 추출 실패 시 피드백 기반 재분석', async () => {
      if (!hasApiKey || !coupangFixture || !fs.existsSync(coupangFixture.pdpHtmlPath)) {
        return;
      }

      console.log('\n=== PDP 복구 루프 테스트 ===');

      const rawHtml = fs.readFileSync(coupangFixture.pdpHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForPDP(rawHtml);
      const testDomain = 'coupang-recovery.com';

      // 1단계: 잘못된 Selector 캐싱
      const wrongSelectors: PDPSelectorMap = {
        productName: ".non-existent-class",
        price: ".wrong-price-selector",
      };

      await selectorRepository.upsert(testDomain, PageType.PDP, wrongSelectors);
      console.log(`1단계: 잘못된 Selector 캐싱`);

      // 2단계: 캐시된 Selector로 추출 시도
      let cached = await selectorRepository.findByDomain(testDomain, PageType.PDP);
      let data = extractorService.extract(rawHtml, cached!.selectors, PageType.PDP) as PDPData;
      let quality = extractorService.evaluatePDPQuality(data);

      console.log(`2단계: 추출 시도 → 품질 ${quality.qualityScore}점 (${quality.hasProductName ? '상품명 O' : '상품명 X'})`);
      expect(quality.hasProductName).toBe(false);

      // 3단계: 복구 - 캐시 무효화 및 피드백 생성
      console.log(`3단계: 복구 시작 (캐시 무효화 + 피드백 기반 AI 재분석)`);
      await selectorRepository.invalidate(testDomain, PageType.PDP);

      const feedback = extractorService.generatePDPQualityFeedback(quality, wrongSelectors);
      console.log(`   피드백: ${feedback.substring(0, 200)}...`);

      // 4단계: 피드백과 함께 AI 재분석
      const newAnalysis = await analyzerService.analyzeWithKnownType(
        filtered.html,
        PageType.PDP,
        feedback,
      );
      await selectorRepository.upsert(testDomain, PageType.PDP, newAnalysis.selectors);

      // 5단계: 새 Selector로 재추출
      cached = await selectorRepository.findByDomain(testDomain, PageType.PDP);
      data = extractorService.extract(rawHtml, cached!.selectors, PageType.PDP) as PDPData;
      quality = extractorService.evaluatePDPQuality(data);

      console.log(`4단계: 재추출 → 품질 ${quality.qualityScore}점`);
      console.log(`   복구된 상품명: ${data.productName?.substring(0, 50)}...`);
      console.log(`   복구된 가격: ${data.price}`);

      // 복구 후 필수 필드가 추출되어야 함
      expect(quality.hasProductName).toBe(true);
      expect(quality.hasPrice).toBe(true);
    }, 300000);
  });

  describe('전체 파이프라인 (End-to-End)', () => {
    it('캐시 미스 → AI 분석 → 추출 → 검증 → 캐시 저장', async () => {
      const coupangFixture = PDP_FIXTURES.find((f) => f.name === 'coupang');
      if (!hasApiKey || !coupangFixture || !fs.existsSync(coupangFixture.pdpHtmlPath)) {
        return;
      }

      console.log('\n' + '='.repeat(50));
      console.log('🚀 PDP 전체 파이프라인 테스트');
      console.log('='.repeat(50));

      const rawHtml = fs.readFileSync(coupangFixture.pdpHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForPDP(rawHtml);
      const testDomain = 'coupang-e2e-pdp.com';
      await selectorRepository.clearAll();

      // Step 1: 캐시 확인 (미스 예상)
      let cached = await selectorRepository.findByDomain(testDomain, PageType.PDP);
      console.log(`\n📌 Step 1: 캐시 확인 → ${cached ? '히트' : '미스'}`);
      expect(cached).toBeNull();

      // Step 2: AI 페이지 분석
      console.log(`📌 Step 2: AI 페이지 분석 중...`);
      const analysis = await analyzerService.analyzeWithKnownType(filtered.html, PageType.PDP);
      console.log(`   → Selector 생성 완료`);

      // Step 3: 데이터 추출
      console.log(`📌 Step 3: 데이터 추출`);
      const data = extractorService.extract(rawHtml, analysis.selectors, PageType.PDP) as PDPData;
      console.log(`   → 상품명: ${data.productName?.substring(0, 40)}...`);
      console.log(`   → 가격: ${data.price}`);

      // Step 4: 품질 검증
      console.log(`📌 Step 4: 품질 검증`);
      const quality = extractorService.evaluatePDPQuality(data);
      const isAcceptable = extractorService.isPDPQualityAcceptable(quality);
      console.log(`   → 품질 점수: ${quality.qualityScore} (${isAcceptable ? '✅ 통과' : '❌ 미달'})`);

      // Step 5: 캐시 저장 (품질 통과 시)
      if (isAcceptable) {
        console.log(`📌 Step 5: 캐시 저장`);
        await selectorRepository.upsert(testDomain, PageType.PDP, analysis.selectors);
      }

      // Step 6: Validation 검증
      console.log(`📌 Step 6: Validation 검증`);
      const validation = validatorService.validate(data, PageType.PDP);
      console.log(`   → 결과: ${validation.isValid ? '✅ PASS' : '❌ FAIL'} (점수: ${validation.score})`);

      // Step 7: 캐시 재확인 (히트 예상)
      cached = await selectorRepository.findByDomain(testDomain, PageType.PDP);
      console.log(`📌 Step 7: 캐시 재확인 → ${cached ? '✅ 히트' : '미스'}`);

      console.log('\n' + '='.repeat(50));
      console.log('✅ PDP 전체 파이프라인 완료');
      console.log('='.repeat(50));

      expect(validation.isValid).toBe(true);
      if (isAcceptable) {
        expect(cached).not.toBeNull();
      }
    }, 180000);
  });

  // 다른 스토어 확장을 위한 동적 테스트
  const otherFixtures = PDP_FIXTURES.filter(
    (f) => f.name !== 'coupang' && f.name !== 'naver' && fs.existsSync(f.pdpHtmlPath),
  );

  // describe.each는 빈 배열을 허용하지 않으므로 조건부 실행
  if (otherFixtures.length > 0) {
    describe.each(otherFixtures)('$name PDP Selector 추출', (fixture) => {
      it(`${fixture.name}: LLM이 PDP에서 필수 필드를 추출해야 함`, async () => {
        if (!hasApiKey) return;

        console.log(`\n=== ${fixture.name} PDP Selector 추출 테스트 ===`);

        const rawHtml = fs.readFileSync(fixture.pdpHtmlPath, 'utf-8');
        const filtered = htmlFilterService.filterForPDP(rawHtml);

        console.log(`HTML 필터링: ${rawHtml.length} → ${filtered.filteredLength} bytes`);

        const analysis = await analyzerService.analyzeWithKnownType(
          filtered.html,
          PageType.PDP,
        );

        console.log('생성된 Selector:', JSON.stringify(analysis.selectors, null, 2));

        const selectors = analysis.selectors as PDPSelectorMap;
        expect(selectors.productName).toBeDefined();

        const extracted = extractorService.extract(rawHtml, selectors, PageType.PDP);

        if (isPDPData(extracted)) {
          const quality = extractorService.evaluatePDPQuality(extracted);
          console.log(`품질 평가: ${quality.qualityScore}점`);

          // JSON 파일로 저장
          savePDPExtractionResult(fixture.name, extracted, selectors, quality);

          // 품질 기준 충족 시 캐시 저장
          if (extractorService.isPDPQualityAcceptable(quality)) {
            await selectorRepository.upsert(fixture.domain, PageType.PDP, selectors);
            console.log(`캐시 저장 완료: ${fixture.domain}`);
          }
        }
      }, 180000);
    });
  }
});
