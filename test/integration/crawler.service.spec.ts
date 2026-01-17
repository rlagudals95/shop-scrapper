import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CrawlerService } from '../../src/application/services/crawler.service';
import { ExtractorService } from '../../src/domain/services/extractor.service';
import { ValidatorService } from '../../src/domain/services/validator.service';
import { AnalyzerService } from '../../src/domain/services/analyzer.service';
import { XPathCacheRepository } from '../../src/infrastructure/database/repositories/xpath-cache.repository';
import { XPathCacheOrmEntity } from '../../src/infrastructure/database/entities/xpath-cache.orm-entity';
import { INJECTION_TOKENS } from '../../src/common';
import { PageType } from '../../src/domain/entities';
import { MockGeminiClient } from '../mocks/gemini.mock';
import { MockBrowserClient } from '../mocks/browser.mock';
import * as fs from 'fs';
import * as path from 'path';

describe('CrawlerService Integration', () => {
  let module: TestingModule;
  let crawlerService: CrawlerService;
  let mockBrowserClient: MockBrowserClient;
  let mockGeminiClient: MockGeminiClient;
  let repository: XPathCacheRepository;

  beforeAll(async () => {
    mockBrowserClient = new MockBrowserClient();
    mockGeminiClient = new MockGeminiClient();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              geminiApiKey: 'test-key',
              databasePath: ':memory:',
              browser: { headless: true, timeout: 30000 },
              crawler: { maxRetries: 3, retryDelay: 100 },
            }),
          ],
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
        ExtractorService,
        ValidatorService,
        AnalyzerService,
        XPathCacheRepository,
        {
          provide: INJECTION_TOKENS.XPATH_REPOSITORY,
          useExisting: XPathCacheRepository,
        },
        {
          provide: INJECTION_TOKENS.BROWSER_CLIENT,
          useValue: mockBrowserClient,
        },
        {
          provide: INJECTION_TOKENS.AI_CLIENT,
          useValue: mockGeminiClient,
        },
      ],
    }).compile();

    crawlerService = module.get<CrawlerService>(CrawlerService);
    repository = module.get<XPathCacheRepository>(XPathCacheRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await repository.clearAll();

    const listingHtml = fs.readFileSync(
      path.join(__dirname, '../fixtures/coupang-listing.html'),
      'utf-8',
    );
    const pdpHtml = fs.readFileSync(
      path.join(__dirname, '../fixtures/coupang-pdp.html'),
      'utf-8',
    );

    mockBrowserClient.setHtmlForUrl('https://www.coupang.com/search?q=phone', listingHtml);
    mockBrowserClient.setHtmlForUrl('https://www.coupang.com/vp/products/12345', pdpHtml);
  });

  describe('crawl listing page', () => {
    it('should crawl and extract products from listing page', async () => {
      const result = await crawlerService.crawlListing(
        'https://www.coupang.com/search?q=phone',
      );

      expect(result.success).toBe(true);
      expect(result.pageType).toBe(PageType.LISTING);
      expect(result.data).toBeDefined();

      if (result.data && 'products' in result.data) {
        expect(result.data.products.length).toBeGreaterThan(0);
      }
    });

    it('should cache XPaths after first crawl', async () => {
      await crawlerService.crawlListing('https://www.coupang.com/search?q=phone');

      const cached = await repository.findByDomain('www.coupang.com', PageType.LISTING);
      expect(cached).not.toBeNull();
    });

    it('should use cached XPaths on second crawl', async () => {
      await crawlerService.crawlListing('https://www.coupang.com/search?q=phone');
      const result = await crawlerService.crawlListing(
        'https://www.coupang.com/search?q=phone',
      );

      expect(result.success).toBe(true);
      expect(result.cached).toBe(true);
    });
  });

  describe('crawl PDP page', () => {
    it('should crawl and extract data from PDP page', async () => {
      const result = await crawlerService.crawlPDP(
        'https://www.coupang.com/vp/products/12345',
      );

      expect(result.success).toBe(true);
      expect(result.pageType).toBe(PageType.PDP);
      expect(result.data).toBeDefined();

      if (result.data && 'productName' in result.data) {
        expect(result.data.productName).toBeTruthy();
        expect(result.data.price).toBeTruthy();
      }
    });
  });

  describe('force reanalyze', () => {
    it('should reanalyze when force flag is set', async () => {
      await crawlerService.crawlListing('https://www.coupang.com/search?q=phone');

      const result = await crawlerService.crawl({
        url: 'https://www.coupang.com/search?q=phone',
        pageType: PageType.LISTING,
        forceReanalyze: true,
      });

      expect(result.success).toBe(true);
      expect(result.cached).toBe(false);
    });
  });
});
