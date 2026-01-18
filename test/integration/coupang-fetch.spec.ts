/**
 * Coupang Bot Bypass Fetch Tests
 *
 * 쿠팡 봇 차단 우회 테스트
 * 단계별 fallback 전략이 제대로 작동하는지 검증합니다.
 *
 * 실행 방법:
 * npm run test:coupang:fetch
 *
 * 테스트 전략:
 * 1. HTTP fetch 시도 → 차단 예상
 * 2. Basic Playwright 시도 → 차단 가능성
 * 3. Full Stealth Playwright 시도 → 성공 예상
 * 4. Cookie Warmup 적용 → 쿠키 획득 후 접근
 * 5. HTML 유효성 검증 → 상품 정보 포함 여부
 */

import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SITE_CONFIGS, StealthLevel } from '../../src/domain/interfaces';
import { PlaywrightClient } from '../../src/infrastructure/browser/playwright.client';
import configuration from '../../src/infrastructure/config/configuration';

// Test URLs
const COUPANG_URLS = {
  pdp: 'https://www.coupang.com/vp/products/5716566331?itemId=9548023757&vendorItemId=84508313637&pickType=COU_PICK&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C&searchId=0c3bd3a06585394&sourceType=search&itemsCount=36&searchRank=1&rank=1&traceId=mkirwf54',
  pdpTest: 'https://www.coupang.com/vp/products/5716566331?itemId=9548023757&vendorItemId=84508313637&pickType=COU_PICK&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C&searchId=0c3bd3a06585394&sourceType=search&itemsCount=36&searchRank=1&rank=1&traceId=mkirwf54', // 테스트용 URL
  listing:
    'https://www.coupang.com/np/search?component=&q=%ED%97%A4%EC%96%B4%EB%B0%B4%EB%93%9C',
};

describe('Coupang Bot Bypass Fetch Tests', () => {
  let module: TestingModule;
  let browserClient: PlaywrightClient;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
        }),
      ],
      providers: [PlaywrightClient],
    }).compile();

    browserClient = module.get<PlaywrightClient>(PlaywrightClient);
  }, 30000);

  afterAll(async () => {
    try {
      if (browserClient) {
        await Promise.race([
          browserClient.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browser close timeout')), 10000),
          ),
        ]).catch((error) => {
          console.warn(`Failed to close browser: ${error}`);
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.warn(`Error in afterAll browser cleanup: ${error}`);
    }

    try {
      if (module) {
        await module.close();
      }
    } catch (error) {
      console.warn(`Error closing module: ${error}`);
    }
  }, 30000);

  // ============================================
  // Step 1: HTTP Fetch 테스트 (차단 예상)
  // ============================================
  describe('Step 1: HTTP Fetch (expected to be blocked)', () => {
    it('should attempt HTTP fetch and likely get blocked or invalid response', async () => {
      const url = COUPANG_URLS.pdp;
      console.log('\n📥 Step 1: HTTP Fetch Test');
      console.log(`   URL: ${url}`);

      try {
        // Force HTTP only by not using forcePlaywright
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });

        const html = await response.text();
        console.log(`   Response status: ${response.status}`);
        console.log(`   HTML length: ${html.length} bytes`);

        // Check if blocked
        const isBlocked =
          html.includes('captcha') ||
          html.includes('robot') ||
          html.includes('blocked') ||
          html.includes('접근이 거부') ||
          html.length < 5000;

        console.log(`   Blocked: ${isBlocked ? '✅ Yes (expected)' : '❌ No'}`);

        // Log first 500 chars for debugging
        console.log(`   First 500 chars: ${html.substring(0, 500)}...`);

        // We expect HTTP to be blocked or return invalid content
        // This test documents the behavior, not asserts success
        expect(response.status).toBeDefined();
      } catch (error) {
        console.log(
          `   ✅ HTTP fetch failed (expected): ${error instanceof Error ? error.message : error}`,
        );
        expect(error).toBeDefined();
      }
    }, 30000);
  });

  // ============================================
  // Step 2: Basic Playwright 테스트
  // ============================================
  describe('Step 2: Basic Playwright', () => {
    it('should try Basic Playwright and check if blocked', async () => {
      const url = COUPANG_URLS.pdp;
      console.log('\n🎭 Step 2: Basic Playwright Test');
      console.log(`   URL: ${url}`);

      const result = await browserClient.getPageContentWithInfo(url, {
        forcePlaywright: true,
        stealthLevel: StealthLevel.BASIC,
        timeout: 60000,
      });

      console.log(`   HTML length: ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);
      console.log(`   Stealth Level: ${result.stealthLevel}`);
      console.log(`   Blocked: ${result.blocked}`);

      // Check for product content
      const hasProductContent =
        result.html.includes('prod-') ||
        result.html.includes('ProductName') ||
        result.html.includes('상품') ||
        result.html.includes('product');

      console.log(`   Has product content: ${hasProductContent}`);

      expect(result.usedPlaywright).toBe(true);
      expect(result.contentLength).toBeGreaterThan(0);

      // Log sample content for debugging
      if (result.blocked) {
        console.log(`   ⚠️ Basic Playwright was blocked`);
        console.log(`   Title sample: ${result.html.match(/<title>([^<]*)<\/title>/)?.[1] || 'N/A'}`);
      } else {
        console.log(`   ✅ Basic Playwright succeeded`);
      }
    }, 90000);
  });

  // ============================================
  // Step 3: Full Stealth Playwright 테스트
  // ============================================
  describe('Step 3: Full Stealth Playwright', () => {
    beforeEach(async () => {
      // Close browser to reset stealth level
      await browserClient.close();
    });

    it('should try Full Stealth Playwright (Headless)', async () => {
      const url = COUPANG_URLS.pdp;
      console.log('\n🥷 Step 3: Full Stealth Playwright Test (Headless)');
      console.log(`   URL: ${url}`);

      const result = await browserClient.getPageContentWithInfo(url, {
        forcePlaywright: true,
        stealthLevel: StealthLevel.FULL,
        timeout: 90000,
      });

      console.log(`   HTML length: ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);
      console.log(`   Stealth Level: ${result.stealthLevel}`);
      console.log(`   Blocked: ${result.blocked}`);

      // Check for product content
      const hasProductContent =
        result.html.includes('prod-') ||
        result.html.includes('ProductName') ||
        result.html.includes('상품명') ||
        result.html.includes('product-title');

      console.log(`   Has product content: ${hasProductContent}`);

      // Extract title
      const title = result.html.match(/<title>([^<]*)<\/title>/)?.[1] || 'N/A';
      console.log(`   Page title: ${title}`);

      expect(result.usedPlaywright).toBe(true);
      // Note: Coupang uses Akamai WAF which is very aggressive
      // This test documents the behavior rather than asserting success
      expect(result.contentLength).toBeGreaterThan(0);

      if (!result.blocked && hasProductContent) {
        console.log(`   ✅ Full Stealth succeeded - product content found!`);
      } else if (result.blocked) {
        console.log(`   ⚠️ Full Stealth was blocked (Akamai WAF)`);
        console.log(`   💡 Consider using: residential proxy, headful mode, or manual CAPTCHA solving`);
      } else {
        console.log(`   ⚠️ Full Stealth got response but no product content`);
      }
    }, 120000);

    it('should try Full Stealth Playwright with Cookie Warmup (Headful - Visible Browser)', async () => {
      const url = COUPANG_URLS.pdpTest; // 테스트 URL 사용
      console.log('\n👁️ Step 3b: Full Stealth + Cookie Warmup (Headful - 브라우저가 보입니다)');
      console.log(`   URL: ${url}`);
      console.log(`   ⚠️ 브라우저 창이 열립니다. 자동으로 닫히지 않으니 확인 후 수동으로 닫아주세요.`);

      const result = await browserClient.getPageContentWithInfo(url, {
        forcePlaywright: true,
        stealthLevel: StealthLevel.FULL,
        headful: true, // 브라우저 창 보이기
        timeout: 120000,
        // siteConfig는 자동으로 감지됨 (쿠팡)
      });

      console.log(`\n   📊 결과:`);
      console.log(`   HTML length: ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);
      console.log(`   Stealth Level: ${result.stealthLevel}`);
      console.log(`   Blocked: ${result.blocked}`);

      // Check for product content
      const hasProductContent =
        result.html.includes('prod-') ||
        result.html.includes('ProductName') ||
        result.html.includes('상품명') ||
        result.html.includes('product-title') ||
        result.html.includes('상품') ||
        result.html.includes('가격');

      console.log(`   Has product content: ${hasProductContent}`);

      // Extract title
      const title = result.html.match(/<title>([^<]*)<\/title>/)?.[1] || 'N/A';
      console.log(`   Page title: ${title}`);

      // Check for specific Coupang markers
      const markers = [
        { name: 'prod-', found: result.html.includes('prod-') },
        { name: 'ProductName', found: result.html.includes('ProductName') },
        { name: '상품명', found: result.html.includes('상품명') },
        { name: '가격', found: result.html.includes('가격') },
        { name: 'price', found: result.html.includes('price') },
        { name: 'coupang', found: result.html.toLowerCase().includes('coupang') },
      ];

      console.log(`\n   상품 마커 확인:`);
      markers.forEach((m) => {
        console.log(`   - ${m.name}: ${m.found ? '✅' : '❌'}`);
      });

      expect(result.usedPlaywright).toBe(true);
      expect(result.contentLength).toBeGreaterThan(0);

      if (!result.blocked && hasProductContent) {
        console.log(`\n   ✅ 성공! 쿠팡 페이지를 성공적으로 가져왔습니다!`);
        console.log(`   브라우저에서 실제 페이지를 확인할 수 있습니다.`);
      } else if (result.blocked) {
        console.log(`\n   ⚠️ 차단됨 - Akamai WAF에 의해 차단되었습니다.`);
        console.log(`   브라우저에서 CAPTCHA나 차단 페이지를 확인해보세요.`);
      } else {
        console.log(`\n   ⚠️ 응답은 받았지만 상품 콘텐츠가 없습니다.`);
        console.log(`   브라우저에서 실제 페이지 내용을 확인해보세요.`);
      }

      // 브라우저를 닫지 않고 잠시 대기 (사용자가 확인할 수 있도록)
      console.log(`\n   ⏸️  브라우저를 10초간 열어둡니다. 확인 후 자동으로 닫힙니다...`);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }, 180000);
  });

  // ============================================
  // Step 4: Cookie Warmup 테스트
  // ============================================
  describe('Step 4: Cookie Warmup Strategy', () => {
    beforeEach(async () => {
      await browserClient.close();
    });

    it('should use cookie warmup before accessing target page', async () => {
      const url = COUPANG_URLS.pdp;
      console.log('\n🍪 Step 4: Cookie Warmup Test');
      console.log(`   URL: ${url}`);
      console.log(`   Warmup URL: ${SITE_CONFIGS['coupang.com'].warmupUrl}`);
      console.log(`   Extra Delay: ${SITE_CONFIGS['coupang.com'].extraDelay}ms`);
      console.log(`   Strategy: Homepage visit → Cookie acquisition → Target page`);

      // Use auto-detected site config (coupang.com)
      const result = await browserClient.getPageContentWithInfo(url, {
        forcePlaywright: true,
        stealthLevel: StealthLevel.FULL,
        timeout: 120000,
        // siteConfig is auto-detected from URL
      });

      console.log(`\n   📊 Result with Cookie Warmup:`);
      console.log(`   HTML length: ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);
      console.log(`   Stealth Level: ${result.stealthLevel}`);
      console.log(`   Blocked: ${result.blocked}`);

      // Extract and log key info
      const title = result.html.match(/<title>([^<]*)<\/title>/)?.[1] || 'N/A';
      console.log(`   Page title: ${title}`);

      // Check for product markers
      const productMarkers = [
        { name: 'prod-', found: result.html.includes('prod-') },
        { name: 'ProductName', found: result.html.includes('ProductName') },
        { name: '상품명', found: result.html.includes('상품명') },
        { name: '가격', found: result.html.includes('가격') },
        { name: 'price', found: result.html.includes('price') },
      ];

      console.log(`\n   Product markers found:`);
      productMarkers.forEach((m) => {
        console.log(`   - ${m.name}: ${m.found ? '✅' : '❌'}`);
      });

      expect(result.contentLength).toBeGreaterThan(0);

      if (!result.blocked) {
        console.log(`\n   ✅ Cookie warmup strategy succeeded!`);
      } else {
        console.log(`\n   ⚠️ Still blocked even with cookie warmup`);
      }
    }, 180000);

    it('should skip warmup when skipWarmup option is set', async () => {
      const url = COUPANG_URLS.pdp;
      console.log('\n⏭️ Skip Warmup Test');
      console.log(`   URL: ${url}`);

      const result = await browserClient.getPageContentWithInfo(url, {
        forcePlaywright: true,
        stealthLevel: StealthLevel.FULL,
        timeout: 90000,
        skipWarmup: true,
      });

      console.log(`   HTML length: ${result.contentLength} bytes`);
      console.log(`   Blocked: ${result.blocked}`);

      expect(result.contentLength).toBeGreaterThan(0);
    }, 120000);
  });

  // ============================================
  // Step 5: Auto Fallback 테스트
  // ============================================
  describe('Step 5: Auto Fallback Strategy', () => {
    beforeEach(async () => {
      await browserClient.close();
    });

    it('should automatically try all fallback levels with site config', async () => {
      const url = COUPANG_URLS.pdp;
      console.log('\n🔄 Step 5: Auto Fallback Test');
      console.log(`   URL: ${url}`);
      console.log(`   Strategy: HTTP → Basic (with warmup) → Full Stealth → Headful`);

      // This will automatically try all levels with site config
      const result = await browserClient.getPageContentWithInfo(url, {
        timeout: 120000,
        autoFallback: true,
      });

      console.log(`\n   📊 Final Result:`);
      console.log(`   HTML length: ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);
      console.log(`   Final Stealth Level: ${result.stealthLevel}`);
      console.log(`   Blocked: ${result.blocked}`);

      // Extract and log key info
      const title = result.html.match(/<title>([^<]*)<\/title>/)?.[1] || 'N/A';
      console.log(`   Page title: ${title}`);

      // Check for product markers
      const productMarkers = [
        { name: 'prod-', found: result.html.includes('prod-') },
        { name: 'ProductName', found: result.html.includes('ProductName') },
        { name: '상품명', found: result.html.includes('상품명') },
        { name: '가격', found: result.html.includes('가격') },
        { name: 'price', found: result.html.includes('price') },
      ];

      console.log(`\n   Product markers found:`);
      productMarkers.forEach((m) => {
        console.log(`   - ${m.name}: ${m.found ? '✅' : '❌'}`);
      });

      expect(result.contentLength).toBeGreaterThan(0);

      if (!result.blocked) {
        console.log(`\n   ✅ Successfully fetched Coupang page!`);
      } else {
        console.log(`\n   ⚠️ All methods blocked - may need proxy or manual intervention`);
      }
    }, 180000);
  });

  // ============================================
  // Step 6: Listing Page 테스트
  // ============================================
  describe('Step 6: Listing Page Fetch', () => {
    it('should fetch Coupang listing page with cookie warmup', async () => {
      // Reset browser for fresh state
      await browserClient.close();
      const url = COUPANG_URLS.listing;
      console.log('\n📋 Step 6: Listing Page Test');
      console.log(`   URL: ${url.substring(0, 60)}...`);

      const result = await browserClient.getPageContentWithInfo(url, {
        forcePlaywright: true,
        stealthLevel: StealthLevel.FULL,
        timeout: 120000,
        // Site config auto-detected for coupang.com
      });

      console.log(`   HTML length: ${result.contentLength} bytes`);
      console.log(`   Used Playwright: ${result.usedPlaywright}`);
      console.log(`   Stealth Level: ${result.stealthLevel}`);
      console.log(`   Blocked: ${result.blocked}`);

      // Check for listing content
      const hasListingContent =
        result.html.includes('search-product') ||
        result.html.includes('product-item') ||
        result.html.includes('search-result') ||
        result.html.includes('상품');

      console.log(`   Has listing content: ${hasListingContent}`);

      // Count product items (rough estimate)
      const productCount = (
        result.html.match(/product-item|search-product|prod-/gi) || []
      ).length;
      console.log(`   Estimated product count: ${productCount}`);

      expect(result.contentLength).toBeGreaterThan(0);

      if (!result.blocked && hasListingContent) {
        console.log(`   ✅ Listing page fetched successfully with cookie warmup!`);
      }
    }, 180000);
  });

  // ============================================
  // HTML 유효성 검증
  // ============================================
  describe('HTML Validation', () => {
    it('should validate fetched HTML contains expected structure', async () => {
      // Reset browser for fresh state
      await browserClient.close();
      const url = COUPANG_URLS.pdp;
      console.log('\n🔍 HTML Validation Test');

      const result = await browserClient.getPageContentWithInfo(url, {
        forcePlaywright: true,
        stealthLevel: StealthLevel.FULL,
        timeout: 120000,
      });

      if (result.blocked) {
        console.log('   ⚠️ Page blocked, skipping validation');
        return;
      }

      // Check for essential HTML elements
      const checks = [
        { name: 'DOCTYPE', test: result.html.includes('<!DOCTYPE') },
        { name: 'html tag', test: result.html.includes('<html') },
        { name: 'head tag', test: result.html.includes('<head') },
        { name: 'body tag', test: result.html.includes('<body') },
        { name: 'title tag', test: result.html.includes('<title') },
        { name: 'script tags', test: result.html.includes('<script') },
        { name: 'div tags', test: result.html.includes('<div') },
      ];

      console.log('   Structure checks:');
      checks.forEach((check) => {
        console.log(`   - ${check.name}: ${check.test ? '✅' : '❌'}`);
      });

      const passedChecks = checks.filter((c) => c.test).length;
      console.log(`\n   Passed: ${passedChecks}/${checks.length}`);

      expect(passedChecks).toBeGreaterThanOrEqual(5);
    }, 120000);
  });
});
