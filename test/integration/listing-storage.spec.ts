/**
 * Listing 저장 통합 테스트
 *
 * CrawlResultRepository를 사용한 Listing 크롤링 결과 DB 저장 테스트
 *
 * 테스트 항목:
 * 1. 세션 및 상품 저장
 * 2. 세션 조회
 * 3. 실패 세션 저장
 * 4. 최근 세션 목록 조회
 *
 * 실행: npm run test -- --testPathPattern=listing-storage
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrawlResultRepository } from '../../src/infrastructure/database/repositories/crawl-result.repository';
import {
  CrawlSessionOrmEntity,
  ListingProductOrmEntity,
} from '../../src/infrastructure/database/entities';
import { ListingData } from '../../src/domain/entities';

describe('Listing Storage Integration', () => {
  let module: TestingModule;
  let repository: CrawlResultRepository;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [CrawlSessionOrmEntity, ListingProductOrmEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([CrawlSessionOrmEntity, ListingProductOrmEntity]),
      ],
      providers: [CrawlResultRepository],
    }).compile();

    repository = module.get<CrawlResultRepository>(CrawlResultRepository);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('saveListingResult', () => {
    it('세션과 상품 목록을 저장해야 함', async () => {
      const listingData: ListingData = {
        products: [
          {
            name: '테스트 상품 1',
            price: '10,000원',
            url: 'https://example.com/product/1',
            thumbnail: 'https://example.com/img/1.jpg',
          },
          {
            name: '테스트 상품 2',
            price: '20,000원',
            url: 'https://example.com/product/2',
            thumbnail: null,
          },
        ],
      };

      const result = await repository.saveListingResult(
        'coupang',
        '헤어밴드',
        'https://www.coupang.com/np/search?q=헤어밴드',
        '<html>test html</html>',
        listingData,
      );

      expect(result.session).toBeDefined();
      expect(result.session.id).toBeGreaterThan(0);
      expect(result.session.site).toBe('coupang');
      expect(result.session.keyword).toBe('헤어밴드');
      expect(result.session.success).toBe(true);
      expect(result.session.productCount).toBe(2);

      expect(result.products).toHaveLength(2);
      expect(result.products[0].name).toBe('테스트 상품 1');
      expect(result.products[0].sessionId).toBe(result.session.id);
      expect(result.products[1].thumbnail).toBeFalsy();
    });
  });

  describe('saveFailedSession', () => {
    it('실패한 세션을 저장해야 함', async () => {
      const session = await repository.saveFailedSession(
        'coupang',
        '실패키워드',
        'Akamai blocked the request',
      );

      expect(session.id).toBeGreaterThan(0);
      expect(session.success).toBe(false);
      expect(session.error).toBe('Akamai blocked the request');
      expect(session.productCount).toBe(0);
    });
  });

  describe('findSessionById', () => {
    it('세션 ID로 조회 시 상품 목록도 함께 조회해야 함', async () => {
      // 먼저 데이터 저장
      const listingData: ListingData = {
        products: [
          {
            name: '조회 테스트 상품',
            price: '5,000원',
            url: 'https://example.com/product/test',
            thumbnail: 'https://example.com/img/test.jpg',
          },
        ],
      };

      const { session } = await repository.saveListingResult(
        'coupang',
        '조회테스트',
        'https://www.coupang.com/np/search?q=조회테스트',
        '<html>html</html>',
        listingData,
      );

      // 조회
      const found = await repository.findSessionById(session.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(session.id);
      expect(found!.products).toHaveLength(1);
      expect(found!.products[0].name).toBe('조회 테스트 상품');
    });

    it('존재하지 않는 ID는 null 반환해야 함', async () => {
      const found = await repository.findSessionById(99999);
      expect(found).toBeNull();
    });
  });

  describe('findRecentSuccessSession', () => {
    it('키워드로 가장 최근 성공 세션을 조회해야 함', async () => {
      const keyword = '성공세션테스트';

      // 실패 세션 먼저 저장
      await repository.saveFailedSession('coupang', keyword, 'error');

      // 성공 세션 저장
      const listingData: ListingData = {
        products: [
          {
            name: '성공 상품',
            price: '1,000원',
            url: 'https://example.com/product/success',
            thumbnail: null,
          },
        ],
      };

      await repository.saveListingResult(
        'coupang',
        keyword,
        'https://www.coupang.com/np/search?q=' + keyword,
        '<html></html>',
        listingData,
      );

      // 조회
      const found = await repository.findRecentSuccessSession('coupang', keyword);

      expect(found).not.toBeNull();
      expect(found!.success).toBe(true);
      expect(found!.keyword).toBe(keyword);
      expect(found!.products).toHaveLength(1);
    });
  });

  describe('findRecentSessions', () => {
    it('최근 세션 목록을 조회해야 함', async () => {
      const sessions = await repository.findRecentSessions(5);

      expect(Array.isArray(sessions)).toBe(true);
      // 이전 테스트에서 생성된 세션들이 있을 것
      expect(sessions.length).toBeGreaterThan(0);

      // 최신순 정렬 확인
      if (sessions.length > 1) {
        expect(sessions[0].createdAt.getTime()).toBeGreaterThanOrEqual(
          sessions[1].createdAt.getTime(),
        );
      }
    });
  });

  describe('findProductsBySessionId', () => {
    it('세션 ID로 상품 목록을 조회해야 함', async () => {
      const listingData: ListingData = {
        products: [
          { name: '상품A', price: '1000원', url: 'url1', thumbnail: null },
          { name: '상품B', price: '2000원', url: 'url2', thumbnail: null },
          { name: '상품C', price: '3000원', url: 'url3', thumbnail: null },
        ],
      };

      const { session } = await repository.saveListingResult(
        'coupang',
        '상품목록테스트',
        'https://example.com',
        '<html></html>',
        listingData,
      );

      const products = await repository.findProductsBySessionId(session.id);

      expect(products).toHaveLength(3);
      expect(products[0].name).toBe('상품A');
      expect(products[2].name).toBe('상품C');
    });
  });
});
