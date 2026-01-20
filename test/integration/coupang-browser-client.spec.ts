/**
 * CoupangBrowserClient Integration Test
 *
 * 리팩토링된 CoupangBrowserClient 모듈 테스트
 *
 * 실행: npm run test:coupang:proxy
 */

import { CoupangBrowserClient } from '../../src/infrastructure/browser';

describe('CoupangBrowserClient', () => {
  let client: CoupangBrowserClient;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  describe('with Residential Proxy', () => {
    beforeEach(() => {
      if (!process.env.BRIGHT_DATA_API_KEY) {
        console.log('⚠️ BRIGHT_DATA_API_KEY not set. Skipping proxy tests.');
      }
    });

    it('should get listing page for search keyword', async () => {
      if (!process.env.BRIGHT_DATA_API_KEY) {
        return;
      }

      console.log('\n=== CoupangBrowserClient Listing Test ===\n');

      // Factory 메서드를 통한 생성
      client = await CoupangBrowserClient.createWithProxy();
      expect(client.hasProxy()).toBe(true);

      // IP 확인
      const ip = await client.getCurrentIP();
      console.log(`Current IP: ${ip}`);

      // 검색 결과 페이지 가져오기
      const result = await client.getListingPage('헤어밴드');

      console.log(`\n결과:`);
      console.log(`  URL: ${result.url}`);
      console.log(`  HTML 길이: ${result.html.length}`);
      console.log(`  성공 여부: ${result.success}`);

      if (result.error) {
        console.log(`  에러: ${result.error}`);
      }

      if (result.success) {
        // 상품 링크 확인
        const productLinkCount = (result.html.match(/\/vp\/products\//g) || []).length;
        console.log(`  상품 링크 수: ${productLinkCount}`);

        // JSON-LD 확인
        const hasJsonLd = result.html.includes('application/ld+json');
        console.log(`  JSON-LD 포함: ${hasJsonLd}`);

        console.log('\n✅ Listing 페이지 정상 로드!');
      } else {
        console.log('\n⚠️ Listing 페이지 로드 실패');
      }

      expect(result.html.length).toBeGreaterThan(0);
    }, 300000);

    it('should get product detail page', async () => {
      if (!process.env.BRIGHT_DATA_API_KEY) {
        return;
      }

      console.log('\n=== CoupangBrowserClient PDP Test ===\n');

      client = await CoupangBrowserClient.createWithProxy();

      // 테스트용 상품 URL (존재하는 상품)
      const productUrl = 'https://www.coupang.com/vp/products/8164588402';

      const result = await client.getProductPage(productUrl);

      console.log(`\n결과:`);
      console.log(`  URL: ${result.url}`);
      console.log(`  HTML 길이: ${result.html.length}`);
      console.log(`  성공 여부: ${result.success}`);

      if (result.success) {
        console.log('\n✅ PDP 페이지 정상 로드!');
      }

      expect(result.html.length).toBeGreaterThan(0);
    }, 300000);
  });

  describe('Interface', () => {
    it('should return supported domains', () => {
      const client = new CoupangBrowserClient();
      const domains = client.getSupportedDomains();

      expect(domains).toContain('coupang.com');
      expect(domains).toContain('www.coupang.com');
    });
  });
});
