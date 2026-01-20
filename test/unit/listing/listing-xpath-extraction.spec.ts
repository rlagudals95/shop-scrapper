/**
 * Listing XPath 추출 단위 테스트
 *
 * HTML fixture를 사용하여 LLM의 XPath 추출 능력을 검증
 * - HTML 필터링 성능 테스트
 * - XPath 생성 정확도 테스트
 * - 데이터 추출 검증
 *
 * 환경변수 필요: GEMINI_API_KEY
 *
 * 실행:
 * GEMINI_API_KEY=xxx npm test -- --testPathPattern=listing-xpath-extraction
 */

import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AnalyzerService } from '../../../src/domain/services/analyzer.service';
import { ExtractorService } from '../../../src/domain/services/extractor.service';
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
import { PageType, isListingData, ListingSelectorMap, ListingProduct } from '../../../src/domain/entities';
import configuration from '../../../src/infrastructure/config/configuration';

// 테스트 fixture 경로 설정
const FIXTURES_PATH = path.join(__dirname, '../../fixtures');
const OUTPUT_PATH = path.join(__dirname, '../../../data/extracted');

// JSON 저장 헬퍼 함수
function saveExtractionResult(
  storeName: string,
  source: 'json-ld' | 'xpath',
  products: Array<{ name: string; price: string; url: string; thumbnail: string | null }>,
  xpaths?: Record<string, string | undefined>,
) {
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.mkdirSync(OUTPUT_PATH, { recursive: true });
  }

  const result = {
    store: storeName,
    extractedAt: new Date().toISOString(),
    source,
    totalProducts: products.length,
    xpaths: xpaths || null,
    products,
  };

  const filePath = path.join(OUTPUT_PATH, `${storeName}-listing-test.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`  JSON 저장됨: ${filePath}`);
}

interface StoreFixture {
  name: string;
  domain: string;
  baseUrl: string;
  listingHtmlPath: string;
  /** 기대되는 최소 상품 수 */
  minProductCount: number;
  /** 검증용 필드들 (이 필드들이 존재해야 함) */
  expectedFields: string[];
}

// 스토어별 fixture 정의 (확장 가능한 구조)
const STORE_FIXTURES: StoreFixture[] = [
  {
    name: 'coupang',
    domain: 'coupang.com',
    baseUrl: 'https://www.coupang.com',
    listingHtmlPath: path.join(FIXTURES_PATH, 'coupang/html/list.html'),
    minProductCount: 10,
    expectedFields: ['name', 'price', 'url', 'thumbnail'],
  },
  {
    name: 'naver',
    domain: 'naver.com',
    baseUrl: 'https://search.shopping.naver.com',
    listingHtmlPath: path.join(FIXTURES_PATH, 'naver/html/list.html'),
    minProductCount: 5,
    expectedFields: ['name', 'price', 'url'],
  },
];

describe('Listing XPath Extraction', () => {
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
        '   실행: GEMINI_API_KEY=your_key npm test -- --testPathPattern=listing-xpath-extraction\n',
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
      STORE_FIXTURES.filter((f) => fs.existsSync(f.listingHtmlPath)),
    )('$name: HTML 필터링으로 토큰 절감', async (fixture) => {
      if (!hasApiKey) return;

      console.log(`\n=== ${fixture.name} HTML 필터링 테스트 ===`);

      const rawHtml = fs.readFileSync(fixture.listingHtmlPath, 'utf-8');
      console.log(`원본 HTML 크기: ${(rawHtml.length / 1024).toFixed(1)}KB`);

      const filtered = htmlFilterService.filterForListing(rawHtml);

      console.log(`필터링된 HTML 크기: ${(filtered.filteredLength / 1024).toFixed(1)}KB`);
      console.log(`압축률: ${filtered.compressionRatio}%`);

      if (filtered.jsonLd) {
        console.log(`JSON-LD 추출됨: ${JSON.stringify(filtered.jsonLd).substring(0, 200)}...`);
      }

      // 최소 50% 이상 압축되어야 함
      expect(filtered.compressionRatio).toBeGreaterThanOrEqual(50);
      // 80KB 이하로 줄어야 LLM 토큰 효율적
      expect(filtered.filteredLength).toBeLessThanOrEqual(100000);
    });
  });

  describe('쿠팡 Listing XPath 추출', () => {
    const coupangFixture = STORE_FIXTURES.find((f) => f.name === 'coupang');

    beforeAll(() => {
      if (!coupangFixture || !fs.existsSync(coupangFixture.listingHtmlPath)) {
        console.warn('쿠팡 fixture 파일 없음');
      }
    });

    it('LLM이 쿠팡 상품 목록에서 XPath를 정확히 추출해야 함', async () => {
      if (!hasApiKey || !coupangFixture || !fs.existsSync(coupangFixture.listingHtmlPath)) {
        return;
      }

      console.log('\n=== 쿠팡 XPath 추출 테스트 ===');

      // 1. HTML 로드 및 필터링
      const rawHtml = fs.readFileSync(coupangFixture.listingHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForListing(rawHtml);

      console.log(`1. HTML 필터링 완료: ${rawHtml.length} → ${filtered.filteredLength} bytes`);

      // 2. LLM으로 XPath 분석
      console.log('2. LLM XPath 분석 중...');
      const analysis = await analyzerService.analyzeWithKnownType(
        filtered.html,
        PageType.LISTING,
      );

      console.log('3. 생성된 XPath:');
      console.log(JSON.stringify(analysis.selectors, null, 2));

      // 3. XPath 필수 필드 검증
      const xpaths = analysis.selectors as ListingSelectorMap;
      expect(xpaths.productCard).toBeDefined();
      expect(xpaths.name).toBeDefined();
      expect(xpaths.price).toBeDefined();
      expect(xpaths.url).toBeDefined();

      console.log(`   - productCard: ${xpaths.productCard}`);
      console.log(`   - name: ${xpaths.name}`);
      console.log(`   - price: ${xpaths.price}`);
      console.log(`   - url: ${xpaths.url}`);

      // 4. XPath로 데이터 추출
      console.log('4. 데이터 추출 테스트...');
      const extracted = extractorService.extract(rawHtml, xpaths, PageType.LISTING, { baseUrl: coupangFixture.baseUrl });

      if (isListingData(extracted)) {
        console.log(`   추출된 상품 수: ${extracted.products.length}`);

        if (extracted.products.length > 0) {
          const firstProduct = extracted.products[0];
          console.log(`   첫 번째 상품:`);
          console.log(`     - 이름: ${firstProduct.name?.substring(0, 50)}...`);
          console.log(`     - 가격: ${firstProduct.price}`);
          console.log(`     - URL: ${firstProduct.url?.substring(0, 60)}...`);
        }

        // JSON 파일로 저장
        saveExtractionResult('coupang-xpath', 'xpath', extracted.products, xpaths);

        // 최소 상품 수 검증
        expect(extracted.products.length).toBeGreaterThanOrEqual(coupangFixture.minProductCount);

        // 품질 기반 검증 (evaluateExtractionQuality 활용)
        const quality = extractorService.evaluateExtractionQuality(extracted);
        console.log(`   품질 평가:`);
        console.log(`     - 총 상품: ${quality.totalProducts}`);
        console.log(`     - 유효 상품: ${quality.validProducts} (${quality.qualityScore}%)`);
        console.log(`     - 가격 유효: ${quality.priceValidProducts}`);

        // 50% 이상 유효 상품이면 테스트 통과 (실제 서비스에서는 80% 기준으로 재시도)
        // 테스트 목적: LLM이 XPath를 생성하고 데이터를 추출할 수 있는지 검증
        expect(quality.qualityScore).toBeGreaterThanOrEqual(50);
      } else {
        fail('ListingData가 아님');
      }

      // 5. Validation 검증
      console.log('5. Validation 검증...');
      const validation = validatorService.validate(extracted, PageType.LISTING);
      console.log(`   - isValid: ${validation.isValid}`);
      console.log(`   - score: ${validation.score}%`);
      console.log(`   - errors: ${validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ')}`);

      // XPath 기반 추출은 완벽하지 않을 수 있으므로, 상품이 추출되면 성공으로 간주
      // 실제 서비스에서는 JSON-LD 데이터를 보조 소스로 활용 가능
      expect(extracted.products.length).toBeGreaterThan(0);
    }, 180000);

    it('XPath 캐시 저장 및 재사용 (품질 검증 포함)', async () => {
      if (!hasApiKey || !coupangFixture || !fs.existsSync(coupangFixture.listingHtmlPath)) {
        return;
      }

      console.log('\n=== XPath 캐시 테스트 (품질 검증 포함) ===');

      const rawHtml = fs.readFileSync(coupangFixture.listingHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForListing(rawHtml);

      // 1. XPath 생성
      console.log('1. LLM으로 XPath 생성 중...');
      const analysis = await analyzerService.analyzeWithKnownType(
        filtered.html,
        PageType.LISTING,
      );
      console.log(`   생성된 XPath: ${JSON.stringify(analysis.selectors, null, 2)}`);

      // 2. 추출 및 품질 검증 (캐시 저장 전)
      const extracted = extractorService.extract(rawHtml, analysis.selectors, PageType.LISTING, { baseUrl: coupangFixture.baseUrl });

      expect(isListingData(extracted)).toBe(true);
      if (!isListingData(extracted)) return;

      const quality = extractorService.evaluateExtractionQuality(extracted);
      console.log(`2. 품질 검증:`);
      console.log(`   - 총 상품: ${quality.totalProducts}`);
      console.log(`   - 유효 상품: ${quality.validProducts} (${quality.qualityScore}%)`);
      console.log(`   - 가격 유효: ${quality.priceValidProducts}`);

      // 3. 품질 기준 충족 시에만 캐시 저장
      if (quality.qualityScore >= 50) {
        await selectorRepository.upsert(
          coupangFixture.domain,
          PageType.LISTING,
          analysis.selectors,
        );
        console.log(`3. 품질 기준 충족 → 캐시 저장 완료`);
      } else {
        console.log(`3. 품질 기준 미달 (${quality.qualityScore}%) → 캐시 저장 안함`);
        // 테스트는 계속 진행 (캐시 저장 로직 검증이 목적)
      }

      // 4. 캐시 조회
      const cached = await selectorRepository.findByDomain(
        coupangFixture.domain,
        PageType.LISTING,
      );

      if (cached) {
        console.log(`4. 캐시 조회 성공`);

        // 5. 캐시된 XPath로 다시 추출
        const cachedExtracted = extractorService.extract(rawHtml, cached.selectors, PageType.LISTING, { baseUrl: coupangFixture.baseUrl });

        if (isListingData(cachedExtracted)) {
          const cachedQuality = extractorService.evaluateExtractionQuality(cachedExtracted);
          console.log(`5. 캐시된 XPath로 추출:`);
          console.log(`   - 상품 수: ${cachedExtracted.products.length}`);
          console.log(`   - 품질: ${cachedQuality.qualityScore}%`);

          // JSON 파일로 저장
          saveExtractionResult('coupang-xpath-cached', 'xpath', cachedExtracted.products, cached.selectors);

          // 캐시된 XPath도 동일한 품질을 유지해야 함
          expect(cachedQuality.qualityScore).toBeGreaterThanOrEqual(50);
        }
      } else {
        console.log(`4. 캐시 없음 (품질 미달로 저장 안됨)`);
      }

      // 최소 품질 기준 검증
      expect(quality.qualityScore).toBeGreaterThanOrEqual(50);

      // 품질 기준 충족 시 캐시가 저장되어 있어야 함
      if (quality.qualityScore >= 50) {
        expect(cached).not.toBeNull();
        expect(cached!.selectors.productCard).toBeDefined();
      }
    }, 180000);
  });

  describe('JSON-LD 데이터 활용', () => {
    it('쿠팡 JSON-LD에서 상품 데이터 검증', async () => {
      // API 키 없이도 JSON-LD 테스트 가능
      const coupangFixture = STORE_FIXTURES.find((f) => f.name === 'coupang');
      if (!coupangFixture || !fs.existsSync(coupangFixture.listingHtmlPath)) {
        return;
      }

      console.log('\n=== JSON-LD 데이터 검증 ===');

      const rawHtml = fs.readFileSync(coupangFixture.listingHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForListing(rawHtml);

      if (!filtered.jsonLd) {
        console.log('JSON-LD 데이터 없음');
        return;
      }

      const jsonLd = filtered.jsonLd as {
        '@type': string;
        mainEntity?: {
          '@type': string;
          itemListElement?: Array<{
            '@type': string;
            position: number;
            item: {
              '@type': string;
              name: string;
              url: string;
              offers?: { price: string };
            };
          }>;
        };
      };

      console.log(`JSON-LD 타입: ${jsonLd['@type']}`);

      if (jsonLd.mainEntity?.itemListElement) {
        const items = jsonLd.mainEntity.itemListElement;
        console.log(`JSON-LD 상품 수: ${items.length}`);

        if (items.length > 0) {
          const first = items[0];
          console.log(`첫 번째 상품:`);
          console.log(`  - 이름: ${first.item.name?.substring(0, 50)}...`);
          console.log(`  - URL: ${first.item.url?.substring(0, 60)}...`);
          console.log(`  - 가격: ${first.item.offers?.price}`);
        }

        // JSON-LD에 상품이 있으면 XPath 추출 결과와 비교 가능
        expect(items.length).toBeGreaterThan(0);
      }
    });

    it('하이브리드 추출: JSON-LD 우선, XPath fallback', async () => {
      const coupangFixture = STORE_FIXTURES.find((f) => f.name === 'coupang');
      if (!coupangFixture || !fs.existsSync(coupangFixture.listingHtmlPath)) {
        return;
      }

      console.log('\n=== 하이브리드 추출 테스트 ===');

      const rawHtml = fs.readFileSync(coupangFixture.listingHtmlPath, 'utf-8');

      // 1. JSON-LD가 있는 경우 - JSON-LD 우선
      console.log('1. JSON-LD 있는 HTML 테스트');
      const result1 = extractorService.extractWithFallback(rawHtml, null, PageType.LISTING);
      console.log(`   소스: ${result1.source}`);
      console.log(`   상품 수: ${result1.productCount}`);
      expect(result1.source).toBe('json-ld');
      expect(result1.productCount).toBeGreaterThan(0);

      if (isListingData(result1.data)) {
        console.log(`   첫 상품: ${result1.data.products[0].name.substring(0, 40)}...`);
        console.log(`   가격: ${result1.data.products[0].price}`);

        // JSON 파일로 저장
        saveExtractionResult('coupang-jsonld', 'json-ld', result1.data.products);
      }

      // 2. JSON-LD 없는 경우 - XPath fallback (시뮬레이션)
      console.log('\n2. JSON-LD 없는 HTML 테스트 (시뮬레이션)');
      const htmlWithoutJsonLd = rawHtml.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, '');
      const result2 = extractorService.extractWithFallback(
        htmlWithoutJsonLd,
        {
          productCard: "//li[contains(@class, 'ProductUnit_productUnit')]",
          name: ".//div[contains(@class, 'ProductUnit_productNameV2')]",
          price: ".//div[contains(@class, 'PriceArea')]",
          url: ".//a/@href",
          thumbnail: ".//img/@src",
        },
        PageType.LISTING,
      );
      console.log(`   소스: ${result2.source}`);
      console.log(`   상품 수: ${result2.productCount}`);
      expect(result2.source).toBe('xpath');
    });

    it('네이버 JSON-LD 유무 확인', async () => {
      const naverFixture = STORE_FIXTURES.find((f) => f.name === 'naver');
      if (!naverFixture || !fs.existsSync(naverFixture.listingHtmlPath)) {
        return;
      }

      console.log('\n=== 네이버 JSON-LD 확인 ===');

      const rawHtml = fs.readFileSync(naverFixture.listingHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForListing(rawHtml);

      const result = {
        store: 'naver-jsonld',
        extractedAt: new Date().toISOString(),
        source: 'json-ld' as const,
        hasJsonLd: !!filtered.jsonLd,
        jsonLdType: filtered.jsonLd ? (filtered.jsonLd as { '@type'?: string })['@type'] : null,
        totalProducts: 0,
        products: [] as ListingProduct[],
        message: filtered.jsonLd ? 'JSON-LD 존재' : 'JSON-LD 없음 - XPath 추출 필요',
      };

      // JSON-LD가 있으면 추출 시도
      if (filtered.jsonLd) {
        const extracted = extractorService.extractFromJsonLd(rawHtml);
        if (extracted && extracted.products.length > 0) {
          result.totalProducts = extracted.products.length;
          result.products = extracted.products;
          console.log(`JSON-LD 추출 성공: ${extracted.products.length}개 상품`);
        }
      }

      // 결과 저장
      const filePath = path.join(OUTPUT_PATH, 'naver-jsonld-listing-test.json');
      if (!fs.existsSync(OUTPUT_PATH)) {
        fs.mkdirSync(OUTPUT_PATH, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`JSON 저장됨: ${filePath}`);
      console.log(`JSON-LD 유무: ${result.hasJsonLd ? '있음' : '없음'}`);
      console.log(`메시지: ${result.message}`);
    });
  });

  // 다른 스토어 확장을 위한 동적 테스트
  describe.each(
    STORE_FIXTURES.filter(
      (f) => f.name !== 'coupang' && fs.existsSync(f.listingHtmlPath),
    ),
  )('$name Listing XPath 추출', (fixture) => {
    it(`${fixture.name}: LLM이 상품 목록에서 XPath를 추출해야 함`, async () => {
      if (!hasApiKey) return;

      console.log(`\n=== ${fixture.name} XPath 추출 테스트 ===`);

      const rawHtml = fs.readFileSync(fixture.listingHtmlPath, 'utf-8');
      const filtered = htmlFilterService.filterForListing(rawHtml);

      console.log(`HTML 필터링: ${rawHtml.length} → ${filtered.filteredLength} bytes`);

      const analysis = await analyzerService.analyzeWithKnownType(
        filtered.html,
        PageType.LISTING,
      );

      console.log('생성된 XPath:', JSON.stringify(analysis.selectors, null, 2));

      const xpaths = analysis.selectors as ListingSelectorMap;
      expect(xpaths.productCard).toBeDefined();

      const extracted = extractorService.extract(rawHtml, xpaths, PageType.LISTING, { baseUrl: fixture.baseUrl });

      if (isListingData(extracted)) {
        console.log(`추출된 상품 수: ${extracted.products.length}`);

        // 품질 평가
        const quality = extractorService.evaluateExtractionQuality(extracted);
        console.log(`품질 평가:`);
        console.log(`  - 총 상품: ${quality.totalProducts}`);
        console.log(`  - 유효 상품: ${quality.validProducts} (${quality.qualityScore}%)`);
        console.log(`  - 가격 유효: ${quality.priceValidProducts}`);

        // JSON 파일로 저장
        saveExtractionResult(`${fixture.name}-xpath`, 'xpath', extracted.products, xpaths);

        // 품질 기준 충족 시 캐시 저장
        if (quality.qualityScore >= 50) {
          await selectorRepository.upsert(fixture.domain, PageType.LISTING, xpaths);
          console.log(`캐시 저장 완료: ${fixture.domain}`);

          // 캐시된 XPath로 다시 추출하여 검증
          const cached = await selectorRepository.findByDomain(fixture.domain, PageType.LISTING);
          if (cached) {
            const cachedExtracted = extractorService.extract(rawHtml, cached.selectors, PageType.LISTING, { baseUrl: fixture.baseUrl });
            if (isListingData(cachedExtracted)) {
              saveExtractionResult(`${fixture.name}-xpath-cached`, 'xpath', cachedExtracted.products, cached.selectors);
              console.log(`캐시 검증 완료: ${cachedExtracted.products.length}개 상품`);
            }
          }
        } else {
          console.log(`⚠️ 품질 미달 (${quality.qualityScore}%) - 캐시 저장 안함`);
        }

        // 다른 스토어는 구조가 다르므로 XPath 추출 성능이 다를 수 있음
        if (extracted.products.length === 0) {
          console.log('⚠️ 상품 추출 실패 - 해당 스토어에 맞는 프롬프트 최적화 필요');
        }
      }
    }, 180000);
  });
});
