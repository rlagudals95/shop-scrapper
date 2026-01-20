/**
 * Coupang Pipeline Unit Tests
 *
 * 쿠팡 HTML fixture를 사용하여 전체 크롤링 파이프라인을 단계별로 테스트합니다.
 * 각 단계가 명확한 입력/출력을 가지며, 네트워크 요청 없이 Mock HTML로 테스트합니다.
 *
 * Pipeline Flow:
 * 1. HTML Fetch -> 2. HTML Analysis -> 3. Data Extraction -> 4. Validation -> 5. Caching
 */

import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { INJECTION_TOKENS } from '../../../src/common';
import { PageType, PDPData, PDPXPathMap } from '../../../src/domain/entities';
import { AnalyzerService } from '../../../src/domain/services/analyzer.service';
import { ExtractorService } from '../../../src/domain/services/extractor.service';
import { ValidatorService } from '../../../src/domain/services/validator.service';
import { XPathCacheOrmEntity } from '../../../src/infrastructure/database/entities/xpath-cache.orm-entity';
import { XPathCacheRepository } from '../../../src/infrastructure/database/repositories/xpath-cache.repository';
import { MockBrowserClient } from '../../mocks/browser.mock';
import { MockGeminiClient } from '../../mocks/gemini.mock';

// ============================================
// Fixture Configuration
// ============================================
const FIXTURE_PATH = path.join(__dirname, '../../fixtures/coupang/html');
const PDP_HTML_PATH = path.join(FIXTURE_PATH, 'pdp.html');

// Expected data from the Coupang PDP fixture
const EXPECTED_DATA = {
  brandName: '써머텍트',
  productName: '써머텍트 기능성 헤어밴드',
  price: '10,630원',
  originalPrice: '15,000원',
  imageCount: 10,
};

// XPaths that match the actual Coupang HTML structure
const COUPANG_PDP_XPATHS: PDPXPathMap = {
  brandName: "//div[contains(@class, 'brand-info')]//div[contains(@class, 'twc-font-bold')]",
  productName: "//h1[contains(@class, 'product-title')]//span",
  price: "//div[contains(@class, 'final-price-amount')]",
  description: "//meta[@name='description']/@content",
  options: "//div[contains(@class, 'option-picker-container')]//option",
  detailImages: "//script[@type='application/ld+json']",
};

describe('Coupang Pipeline Tests', () => {
  let pdpHtml: string;

  beforeAll(() => {
    // Load HTML fixture once
    pdpHtml = fs.readFileSync(PDP_HTML_PATH, 'utf-8');
  });

  // ============================================
  // Step 1: HTML Fetch Tests
  // ============================================
  describe('Step 1: HTML Fetch', () => {
    let mockBrowserClient: MockBrowserClient;

    beforeEach(() => {
      mockBrowserClient = new MockBrowserClient();
    });

    it('should load HTML from fixture file', () => {
      expect(pdpHtml).toBeDefined();
      expect(pdpHtml.length).toBeGreaterThan(0);
      console.log(`📄 Loaded HTML: ${pdpHtml.length} bytes`);
    });

    it('should contain expected product data markers', () => {
      // Check for key elements in the HTML
      expect(pdpHtml).toContain('써머텍트');
      expect(pdpHtml).toContain('기능성 헤어밴드');
      expect(pdpHtml).toContain('10,630원');
      expect(pdpHtml).toContain('product-title');
      expect(pdpHtml).toContain('application/ld+json');
    });

    it('should mock browser client return HTML correctly', async () => {
      const testUrl = 'https://www.coupang.com/vp/products/5716566331';
      mockBrowserClient.setHtmlForUrl(testUrl, pdpHtml);

      const result = await mockBrowserClient.getPageContent(testUrl);

      expect(result).toBe(pdpHtml);
      expect(result.length).toBe(pdpHtml.length);
      console.log(`✅ MockBrowserClient returned ${result.length} bytes`);
    });

    it('should throw error for unconfigured URL', async () => {
      await expect(
        mockBrowserClient.getPageContent('https://unknown.com'),
      ).rejects.toThrow('No mock HTML configured');
    });
  });

  // ============================================
  // Step 2: HTML Analysis Tests
  // ============================================
  describe('Step 2: HTML Analysis', () => {
    let analyzerService: AnalyzerService;
    let mockAiClient: MockGeminiClient;

    beforeEach(async () => {
      mockAiClient = new MockGeminiClient();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AnalyzerService,
          {
            provide: INJECTION_TOKENS.AI_CLIENT,
            useValue: mockAiClient,
          },
        ],
      }).compile();

      analyzerService = module.get<AnalyzerService>(AnalyzerService);
    });

    it('should detect PDP page type from Coupang HTML', async () => {
      // Setup mock response for page type detection
      mockAiClient.setResponse('페이지 유형을 판별', JSON.stringify({
        pageType: 'PDP',
        confidence: 0.95,
        reasoning: 'Single product detail page with price, brand, and product name',
      }));

      // Setup mock response for XPath generation
      mockAiClient.setResponse('상품 상세 페이지', JSON.stringify(COUPANG_PDP_XPATHS));

      const result = await analyzerService.analyze(pdpHtml);

      expect(result.pageType).toBe(PageType.PDP);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      console.log(`✅ Detected page type: ${result.pageType} (confidence: ${result.confidence})`);
    });

    it('should generate valid XPaths for Coupang structure', async () => {
      mockAiClient.setResponse('페이지 유형을 판별', JSON.stringify({
        pageType: 'PDP',
        confidence: 0.95,
        reasoning: 'Product detail page',
      }));

      mockAiClient.setResponse('상품 상세 페이지', JSON.stringify(COUPANG_PDP_XPATHS));

      const result = await analyzerService.analyze(pdpHtml);

      expect(result.xpaths).toBeDefined();
      expect(result.xpaths).toHaveProperty('productName');
      expect(result.xpaths).toHaveProperty('price');

      console.log('✅ Generated XPaths:');
      console.log(JSON.stringify(result.xpaths, null, 2));
    });

    it('should simplify HTML before sending to AI', () => {
      // Access private method through any type
      const simplified = (analyzerService as any).simplifyHtml(pdpHtml);

      // Simplified HTML should be smaller
      expect(simplified.length).toBeLessThan(pdpHtml.length);

      // Should not contain script content (JavaScript code)
      expect(simplified).not.toContain('function(');
      expect(simplified).not.toContain('self.__next_f.push');

      console.log(`✅ HTML simplified: ${pdpHtml.length} -> ${simplified.length} bytes (${Math.round(simplified.length / pdpHtml.length * 100)}%)`);
    });
  });

  // ============================================
  // Step 3: Data Extraction Tests
  // ============================================
  describe('Step 3: Data Extraction', () => {
    let extractorService: ExtractorService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [ExtractorService],
      }).compile();

      extractorService = module.get<ExtractorService>(ExtractorService);
    });

    it('should extract brand name from Coupang PDP', () => {
      const result = extractorService.extract(pdpHtml, COUPANG_PDP_XPATHS, PageType.PDP) as PDPData;

      expect(result.brandName).toBeDefined();
      expect(result.brandName).toContain(EXPECTED_DATA.brandName);
      console.log(`✅ Extracted brand: "${result.brandName}"`);
    });

    it('should extract product name from Coupang PDP', () => {
      const result = extractorService.extract(pdpHtml, COUPANG_PDP_XPATHS, PageType.PDP) as PDPData;

      expect(result.productName).toBeDefined();
      expect(result.productName).toContain(EXPECTED_DATA.productName);
      console.log(`✅ Extracted product name: "${result.productName}"`);
    });

    it('should extract price from Coupang PDP', () => {
      const result = extractorService.extract(pdpHtml, COUPANG_PDP_XPATHS, PageType.PDP) as PDPData;

      expect(result.price).toBeDefined();
      expect(result.price).toContain('10,630');
      console.log(`✅ Extracted price: "${result.price}"`);
    });

    it('should extract all required PDP fields', () => {
      const result = extractorService.extract(pdpHtml, COUPANG_PDP_XPATHS, PageType.PDP) as PDPData;

      console.log('\n📦 Extracted Data Summary:');
      console.log(`   Brand: ${result.brandName}`);
      console.log(`   Product: ${result.productName}`);
      console.log(`   Price: ${result.price}`);
      console.log(`   Description: ${result.description?.substring(0, 50)}...`);
      console.log(`   Options: ${result.options?.length || 0} items`);
      console.log(`   Images: ${result.detailImages?.length || 0} items`);

      // Verify required fields are present
      expect(result.productName).toBeTruthy();
      expect(result.price).toBeTruthy();
    });

    it('should handle missing optional fields gracefully', () => {
      const minimalXPaths: PDPXPathMap = {
        productName: "//h1[contains(@class, 'product-title')]//span",
        price: "//div[contains(@class, 'final-price-amount')]",
      };

      const result = extractorService.extract(pdpHtml, minimalXPaths, PageType.PDP) as PDPData;

      expect(result.productName).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(result.brandName).toBeNull();
      expect(result.options).toEqual([]);
      expect(result.detailImages).toEqual([]);
    });
  });

  // ============================================
  // Step 4: Validation Tests
  // ============================================
  describe('Step 4: Validation', () => {
    let validatorService: ValidatorService;
    let extractorService: ExtractorService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [ValidatorService, ExtractorService],
      }).compile();

      validatorService = module.get<ValidatorService>(ValidatorService);
      extractorService = module.get<ExtractorService>(ExtractorService);
    });

    it('should validate successfully extracted PDP data', () => {
      const extractedData = extractorService.extract(pdpHtml, COUPANG_PDP_XPATHS, PageType.PDP) as PDPData;
      const validationResult = validatorService.validate(extractedData, PageType.PDP);

      console.log('\n✅ Validation Result:');
      console.log(`   Valid: ${validationResult.isValid}`);
      console.log(`   Errors: ${validationResult.errors.length}`);
      console.log(`   Warnings: ${validationResult.warnings.length}`);

      if (!validationResult.isValid) {
        console.log('   Error details:', validationResult.errors);
      }

      expect(validationResult.isValid).toBe(true);
      expect(validationResult.errors).toHaveLength(0);
    });

    it('should generate feedback for missing required fields', () => {
      const incompleteData: PDPData = {
        productName: '',
        price: '',
        brandName: null,
        description: null,
        options: [],
        detailImages: [],
      };

      const validationResult = validatorService.validate(incompleteData, PageType.PDP);

      expect(validationResult.isValid).toBe(false);
      expect(validationResult.errors.length).toBeGreaterThan(0);

      const feedback = validatorService.generateRecoveryFeedback(validationResult);

      console.log('\n📝 Validation Feedback:');
      console.log(feedback);

      expect(feedback).toContain('productName');
      expect(feedback).toContain('price');
    });

    it('should validate partial data with only required fields', () => {
      const partialData: PDPData = {
        productName: '테스트 상품',
        price: '10,000원',
        brandName: null,
        description: null,
        options: [],
        detailImages: [],
      };

      const validationResult = validatorService.validate(partialData, PageType.PDP);

      // Should pass validation with only required fields
      expect(validationResult.isValid).toBe(true);
      expect(validationResult.errors).toHaveLength(0);

      // Score should reflect missing optional fields (less than 100)
      expect(validationResult.score).toBeLessThan(100);

      console.log('\n📊 Partial Data Validation:');
      console.log(`   Valid: ${validationResult.isValid}`);
      console.log(`   Score: ${validationResult.score}`);
    });
  });

  // ============================================
  // Step 5: Caching Tests
  // ============================================
  describe('Step 5: Caching', () => {
    let repository: XPathCacheRepository;
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          TypeOrmModule.forRoot({
            type: 'better-sqlite3',
            database: ':memory:',
            entities: [XPathCacheOrmEntity],
            synchronize: true,
          }),
          TypeOrmModule.forFeature([XPathCacheOrmEntity]),
        ],
        providers: [XPathCacheRepository],
      }).compile();

      repository = module.get<XPathCacheRepository>(XPathCacheRepository);
    });

    afterAll(async () => {
      await module.close();
    });

    beforeEach(async () => {
      await repository.clearAll();
    });

    it('should save XPaths to cache', async () => {
      const domain = 'www.coupang.com';
      const pageType = PageType.PDP;

      await repository.upsert(domain, pageType, COUPANG_PDP_XPATHS);

      const cached = await repository.findByDomain(domain, pageType);

      expect(cached).not.toBeNull();
      expect(cached?.siteDomain).toBe(domain);
      expect(cached?.pageType).toBe(pageType);
      expect(cached?.xpaths).toEqual(COUPANG_PDP_XPATHS);

      console.log('\n💾 Cached XPaths:');
      console.log(`   Domain: ${cached?.siteDomain}`);
      console.log(`   Page Type: ${cached?.pageType}`);
      console.log(`   XPaths: ${Object.keys(cached?.xpaths || {}).length} fields`);
    });

    it('should retrieve cached XPaths', async () => {
      const domain = 'www.coupang.com';

      // Save first
      await repository.upsert(domain, PageType.PDP, COUPANG_PDP_XPATHS);

      // Retrieve
      const cached = await repository.findByDomain(domain, PageType.PDP);

      expect(cached).not.toBeNull();
      expect(cached?.xpaths.productName).toBe(COUPANG_PDP_XPATHS.productName);
      expect(cached?.xpaths.price).toBe(COUPANG_PDP_XPATHS.price);

      console.log('✅ Successfully retrieved cached XPaths');
    });

    it('should update existing cache entry', async () => {
      const domain = 'www.coupang.com';

      // Save initial
      await repository.upsert(domain, PageType.PDP, COUPANG_PDP_XPATHS);

      // Update with new XPaths
      const updatedXPaths: PDPXPathMap = {
        ...COUPANG_PDP_XPATHS,
        productName: "//h1[@class='new-product-title']",
      };

      await repository.upsert(domain, PageType.PDP, updatedXPaths);

      // Verify update
      const cached = await repository.findByDomain(domain, PageType.PDP);

      expect(cached?.xpaths.productName).toBe("//h1[@class='new-product-title']");
      console.log('✅ Successfully updated cached XPaths');
    });

    it('should maintain separate caches for different page types', async () => {
      const domain = 'www.coupang.com';

      // Save PDP cache
      await repository.upsert(domain, PageType.PDP, COUPANG_PDP_XPATHS);

      // Save Listing cache (different structure)
      const listingXPaths = {
        productCard: "//li[contains(@class, 'search-product')]",
        name: ".//div[@class='name']",
        price: ".//span[@class='price-value']",
        url: ".//a/@href",
        thumbnail: ".//img/@src",
      };

      await repository.upsert(domain, PageType.LISTING, listingXPaths);

      // Verify both exist separately
      const pdpCache = await repository.findByDomain(domain, PageType.PDP);
      const listingCache = await repository.findByDomain(domain, PageType.LISTING);

      expect(pdpCache).not.toBeNull();
      expect(listingCache).not.toBeNull();
      expect(pdpCache?.xpaths).not.toEqual(listingCache?.xpaths);

      console.log('✅ PDP and Listing caches are separate');
    });
  });

  // ============================================
  // Full Pipeline Integration Test
  // ============================================
  describe('Full Pipeline Integration', () => {
    let extractorService: ExtractorService;
    let validatorService: ValidatorService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [ExtractorService, ValidatorService],
      }).compile();

      extractorService = module.get<ExtractorService>(ExtractorService);
      validatorService = module.get<ValidatorService>(ValidatorService);
    });

    it('should complete full pipeline: HTML -> Extract -> Validate', () => {
      console.log('\n🚀 Running Full Pipeline Test');
      console.log('================================');

      // Step 1: HTML is already loaded
      console.log(`\n📄 Step 1: HTML Loaded (${pdpHtml.length} bytes)`);

      // Step 2: Using predefined XPaths (simulating AI analysis)
      console.log('\n🔍 Step 2: Using XPaths for Coupang structure');
      console.log(JSON.stringify(COUPANG_PDP_XPATHS, null, 2));

      // Step 3: Extract data
      console.log('\n📦 Step 3: Extracting data...');
      const extractedData = extractorService.extract(
        pdpHtml,
        COUPANG_PDP_XPATHS,
        PageType.PDP,
      ) as PDPData;

      console.log('   Extracted:');
      console.log(`   - Brand: ${extractedData.brandName}`);
      console.log(`   - Product: ${extractedData.productName}`);
      console.log(`   - Price: ${extractedData.price}`);

      // Step 4: Validate
      console.log('\n✅ Step 4: Validating...');
      const validationResult = validatorService.validate(extractedData, PageType.PDP);

      console.log(`   Valid: ${validationResult.isValid}`);
      console.log(`   Errors: ${validationResult.errors.length}`);
      console.log(`   Warnings: ${validationResult.warnings.length}`);

      // Final assertions
      expect(extractedData.productName).toContain('써머텍트');
      expect(extractedData.price).toContain('10,630');
      expect(validationResult.isValid).toBe(true);

      console.log('\n================================');
      console.log('✅ Pipeline completed successfully!');
    });
  });
});
