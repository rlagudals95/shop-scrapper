/**
 * Akamai Bot Detection Analysis
 *
 * 쿠팡 페이지에서 Akamai가 어떤 JS를 로드하고 어떤 값을 체크하는지 분석
 *
 * 실행: npx jest test/integration/akamai-detection-analysis.spec.ts
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';

describe('Akamai Detection Analysis', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: false,
      devtools: true, // DevTools 열어서 네트워크 탭 확인 가능
    });
    context = await browser.newContext();
    page = await context.newPage();
  }, 30000);

  afterAll(async () => {
    // 브라우저 열어두고 분석할 수 있게 대기
    console.log('\n브라우저가 30초간 열려있습니다. DevTools에서 Network 탭을 확인하세요.');
    await new Promise(resolve => setTimeout(resolve, 30000));

    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }, 60000);

  it('should analyze Akamai scripts on Coupang', async () => {
    console.log('\n=== Akamai Detection Analysis ===\n');

    // 네트워크 요청 로깅
    const akamaiRequests: string[] = [];
    const allScripts: string[] = [];

    page.on('request', request => {
      const url = request.url();

      // Akamai 관련 요청 필터링
      if (url.includes('akamai') ||
          url.includes('akam') ||
          url.includes('sensor') ||
          url.includes('_abck') ||
          url.includes('bm') ||
          url.includes('challenge')) {
        akamaiRequests.push(url);
        console.log(`[AKAMAI REQUEST] ${url.substring(0, 100)}`);
      }

      // 모든 스크립트 요청
      if (request.resourceType() === 'script') {
        allScripts.push(url);
      }
    });

    // 쿠키 로깅
    page.on('response', async response => {
      const headers = response.headers();
      const setCookie = headers['set-cookie'];
      if (setCookie && (setCookie.includes('_abck') || setCookie.includes('bm_'))) {
        console.log(`[AKAMAI COOKIE] ${setCookie.substring(0, 100)}...`);
      }
    });

    // 쿠팡 메인 페이지 접속
    console.log('Navigating to Coupang main page...');
    await page.goto('https://www.coupang.com', { waitUntil: 'networkidle' });

    // 페이지 로드 후 대기
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 결과 출력
    console.log('\n--- Akamai Related Requests ---');
    akamaiRequests.forEach((url, i) => {
      console.log(`${i + 1}. ${url}`);
    });

    console.log('\n--- All Script Requests ---');
    allScripts.forEach((url, i) => {
      console.log(`${i + 1}. ${url.substring(0, 100)}`);
    });

    // 쿠키 확인
    const cookies = await context.cookies();
    console.log('\n--- Cookies ---');
    cookies.forEach(cookie => {
      if (cookie.name.includes('_abck') ||
          cookie.name.includes('bm_') ||
          cookie.name.includes('ak_')) {
        console.log(`[AKAMAI] ${cookie.name}: ${cookie.value.substring(0, 50)}...`);
      }
    });

    // 페이지 내 Akamai 관련 전역 변수 확인
    const akamaiGlobals = await page.evaluate(() => {
      const globals: Record<string, any> = {};

      // 알려진 Akamai 전역 변수들
      const akamaiVars = [
        '_abck', 'bmak', 'bm_sv', 'bm_sz', 'bm_mi',
        'akm', 'akamai', 'ak_bmsc',
        '_cf', // Cloudflare
        'challenge',
      ];

      for (const varName of akamaiVars) {
        if (varName in window) {
          // @ts-ignore
          const val = window[varName];
          globals[varName] = typeof val === 'object' ? 'object' : val;
        }
      }

      return globals;
    });

    console.log('\n--- Akamai Global Variables ---');
    console.log(JSON.stringify(akamaiGlobals, null, 2));

    // navigator.webdriver 체크 스크립트가 있는지 확인
    const pageContent = await page.content();
    const webdriverDetection = pageContent.includes('webdriver') ||
                               pageContent.includes('navigator.webdriver');
    console.log(`\n--- webdriver detection in page: ${webdriverDetection} ---`);

    // HTML에 포함된 인라인 스크립트 분석
    const inlineScripts = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      return scripts
        .filter(s => !s.src && s.textContent)
        .map(s => s.textContent?.substring(0, 200) || '')
        .filter(s => s.includes('webdriver') ||
                     s.includes('navigator') ||
                     s.includes('detection') ||
                     s.includes('fingerprint') ||
                     s.includes('challenge'));
    });

    console.log('\n--- Suspicious Inline Scripts ---');
    inlineScripts.forEach((script, i) => {
      console.log(`${i + 1}. ${script}...`);
    });

  }, 120000);

  it('should test with webdriver property masked', async () => {
    console.log('\n=== Testing with webdriver masking ===\n');

    // 새 페이지 생성
    const testPage = await context.newPage();

    // webdriver 마스킹 시도 (페이지 로드 전)
    await testPage.addInitScript(() => {
      // Method 1: delete and redefine
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      });

      // Method 2: Proxy navigator
      // @ts-ignore
      const originalNavigator = window.navigator;
      // @ts-ignore
      window.navigator = new Proxy(originalNavigator, {
        get: (target, prop) => {
          if (prop === 'webdriver') return false;
          return Reflect.get(target, prop);
        },
      });
    });

    await testPage.goto('about:blank');

    // 마스킹 결과 확인
    const result = await testPage.evaluate(() => {
      return {
        webdriver: navigator.webdriver,
        webdriverDescriptor: Object.getOwnPropertyDescriptor(navigator, 'webdriver'),
        // Akamai는 여러 방법으로 체크함
        webdriverViaGet: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'webdriver'),
      };
    });

    console.log('After masking:');
    console.log(`  navigator.webdriver: ${result.webdriver}`);
    console.log(`  descriptor: ${JSON.stringify(result.webdriverDescriptor)}`);
    console.log(`  prototype descriptor: ${JSON.stringify(result.webdriverViaGet)}`);

    await testPage.close();
  }, 30000);
});
