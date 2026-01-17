import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XPathCacheRepository } from '../../../src/infrastructure/database/repositories/xpath-cache.repository';
import { XPathCacheOrmEntity } from '../../../src/infrastructure/database/entities/xpath-cache.orm-entity';
import { PageType } from '../../../src/domain/entities';

describe('XPathCacheRepository', () => {
  let repository: XPathCacheRepository;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
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

  afterEach(async () => {
    await repository.clearAll();
  });

  describe('upsert', () => {
    it('should create new cache entry', async () => {
      const domain = 'coupang.com';
      const pageType = PageType.LISTING;
      const xpaths = {
        productCard: '//div[@class="product"]',
        name: './/span[@class="name"]',
      };

      const result = await repository.upsert(domain, pageType, xpaths);

      expect(result.siteDomain).toBe(domain);
      expect(result.pageType).toBe(pageType);
      expect(result.xpaths).toEqual(xpaths);
      expect(result.id).toBeDefined();
    });

    it('should update existing cache entry', async () => {
      const domain = 'coupang.com';
      const pageType = PageType.LISTING;
      const xpaths1 = { productCard: '//div[@class="old"]' };
      const xpaths2 = { productCard: '//div[@class="new"]' };

      await repository.upsert(domain, pageType, xpaths1);
      const result = await repository.upsert(domain, pageType, xpaths2);

      expect(result.xpaths).toEqual(xpaths2);

      const all = await repository.findAll();
      expect(all.filter((c) => c.siteDomain === domain && c.pageType === pageType)).toHaveLength(1);
    });
  });

  describe('findByDomain', () => {
    it('should find cache by domain and page type', async () => {
      const domain = 'naver.com';
      const pageType = PageType.PDP;
      const xpaths = { productName: '//h1[@class="title"]' };

      await repository.upsert(domain, pageType, xpaths);

      const result = await repository.findByDomain(domain, pageType);

      expect(result).not.toBeNull();
      expect(result!.siteDomain).toBe(domain);
      expect(result!.pageType).toBe(pageType);
    });

    it('should return null when cache does not exist', async () => {
      const result = await repository.findByDomain('nonexistent.com', PageType.LISTING);

      expect(result).toBeNull();
    });
  });

  describe('invalidate', () => {
    it('should delete cache for specific domain and page type', async () => {
      const domain = 'test.com';
      await repository.upsert(domain, PageType.LISTING, { a: 'b' });
      await repository.upsert(domain, PageType.PDP, { c: 'd' });

      await repository.invalidate(domain, PageType.LISTING);

      const listing = await repository.findByDomain(domain, PageType.LISTING);
      const pdp = await repository.findByDomain(domain, PageType.PDP);

      expect(listing).toBeNull();
      expect(pdp).not.toBeNull();
    });

    it('should delete all caches for domain when page type not specified', async () => {
      const domain = 'test.com';
      await repository.upsert(domain, PageType.LISTING, { a: 'b' });
      await repository.upsert(domain, PageType.PDP, { c: 'd' });

      await repository.invalidate(domain);

      const listing = await repository.findByDomain(domain, PageType.LISTING);
      const pdp = await repository.findByDomain(domain, PageType.PDP);

      expect(listing).toBeNull();
      expect(pdp).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all cache entries', async () => {
      await repository.upsert('site1.com', PageType.LISTING, { a: 'b' });
      await repository.upsert('site2.com', PageType.PDP, { c: 'd' });

      const result = await repository.findAll();

      expect(result).toHaveLength(2);
    });
  });

  describe('clearAll', () => {
    it('should clear all cache entries', async () => {
      await repository.upsert('site1.com', PageType.LISTING, { a: 'b' });
      await repository.upsert('site2.com', PageType.PDP, { c: 'd' });

      await repository.clearAll();

      const result = await repository.findAll();
      expect(result).toHaveLength(0);
    });
  });
});
