/**
 * Stealth Test - webdriver 마스킹으로 쿠팡 접근 테스트
 *
 * 실행: npx jest test/integration/stealth-test.spec.ts
 */

import { chromium, firefox, Browser, BrowserContext, Page } from 'playwright';

describe('Stealth Mode Test', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  afterEach(async () => {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  });

  /**
   * Stealth 설정으로 쿠팡 접근 테스트
   */
  it('should access Coupang with stealth settings', async () => {
    console.log('\n=== Stealth Mode Coupang Test ===\n');

    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
      ],
    });

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });

    page = await context.newPage();

    // Stealth 스크립트 주입
    await page.addInitScript(() => {
      // 1. navigator.webdriver 마스킹
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 2. chrome.runtime 추가 (진짜 Chrome 처럼)
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};

      // 3. 플러그인 배열 조작 (빈 배열 회피)
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', filename: 'internal-nacl-plugin' },
          ];
          // @ts-ignore
          plugins.item = (i: number) => plugins[i];
          // @ts-ignore
          plugins.namedItem = (name: string) => plugins.find(p => p.name === name);
          // @ts-ignore
          plugins.refresh = () => {};
          return plugins as unknown as PluginArray;
        },
      });

      // 4. 언어 배열 확장
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en'],
      });

      // 5. Permissions API 조작
      const originalQuery = Permissions.prototype.query;
      Permissions.prototype.query = async function(desc: PermissionDescriptor) {
        if (desc.name === 'notifications') {
          return { state: 'prompt', onchange: null } as PermissionStatus;
        }
        return originalQuery.call(this, desc);
      };

      // 6. WebGL 정보 보호
      const getParameterProxyHandler = {
        apply(target: any, thisArg: any, args: any[]) {
          const param = args[0];
          // UNMASKED_VENDOR_WEBGL = 37445
          // UNMASKED_RENDERER_WEBGL = 37446
          if (param === 37445) {
            return 'Intel Inc.';
          }
          if (param === 37446) {
            return 'Intel Iris OpenGL Engine';
          }
          return Reflect.apply(target, thisArg, args);
        },
      };

      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          // @ts-ignore
          const originalGetParameter = gl.getParameter.bind(gl);
          // @ts-ignore
          gl.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
        }
      } catch {}

      // 7. 타임스탬프 노이즈 추가 (일관된 타이밍 방지)
      const originalNow = Date.now;
      Date.now = () => originalNow() + Math.floor(Math.random() * 10);

      // 8. console.debug 마스킹 (일부 탐지 스크립트가 사용)
      // @ts-ignore
      window.console.debug = () => {};
    });

    // 핑거프린트 확인
    await page.goto('about:blank');
    const fingerprint = await page.evaluate(() => ({
      webdriver: navigator.webdriver,
      // @ts-ignore
      chromeRuntime: !!window.chrome?.runtime,
      plugins: navigator.plugins.length,
      languages: navigator.languages,
    }));

    console.log('Stealth fingerprint:');
    console.log(`  webdriver: ${fingerprint.webdriver}`);
    console.log(`  chrome.runtime: ${fingerprint.chromeRuntime}`);
    console.log(`  plugins: ${fingerprint.plugins}`);
    console.log(`  languages: ${JSON.stringify(fingerprint.languages)}`);

    // 네이버 먼저 방문 (레퍼러 설정)
    console.log('\nStep 1: Visiting Naver...');
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));

    // 쿠팡 검색
    console.log('Step 2: Searching for Coupang on Naver...');
    await page.locator('input[name="query"]').fill('쿠팡');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await new Promise(r => setTimeout(r, 3000));

    // 쿠팡 링크 클릭 (새 탭)
    console.log('Step 3: Clicking Coupang link...');
    const coupangLink = page.locator('a:has-text("쿠팡")').first();
    const href = await coupangLink.getAttribute('href');
    console.log(`  Found link: ${href}`);

    // 새 탭에서 쿠팡 열기
    const coupangPage = await context.newPage();
    await coupangPage.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};
    });

    console.log('Step 4: Navigating to Coupang...');
    await coupangPage.goto(href || 'https://www.coupang.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 결과 대기 및 확인
    console.log('Step 5: Waiting for page load...');
    await new Promise(r => setTimeout(r, 10000));

    // JS 챌린지 페이지인지 확인
    const html = await coupangPage.content();
    const isChallenge = html.includes('XMLHttpRequest.prototype.send') ||
                        html.includes('location.reload') ||
                        (html.length < 5000 && html.includes('<script'));

    console.log(`\n결과:`);
    console.log(`  HTML 길이: ${html.length}`);
    console.log(`  JS 챌린지 페이지: ${isChallenge}`);

    if (isChallenge) {
      console.log('\n⚠️  여전히 JS 챌린지 페이지입니다.');
      console.log('   webdriver 마스킹만으로는 부족합니다.');
      console.log('\n챌린지 페이지 앞부분:');
      console.log(html.substring(0, 500));
    } else {
      // 검색창 확인
      const searchInput = coupangPage.locator('#wa-search-form input.headerSearchKeyword');
      const isVisible = await searchInput.isVisible().catch(() => false);
      console.log(`  검색창 표시: ${isVisible}`);

      if (isVisible) {
        console.log('\n✅ 쿠팡 페이지 정상 로드!');
      }
    }

    await coupangPage.close();
  }, 180000);

  /**
   * 쿠팡 검색 결과 페이지까지 접근 테스트
   */
  it('should access Coupang search results with stealth', async () => {
    console.log('\n=== Stealth Mode Coupang SEARCH Test ===\n');

    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
      ],
    });

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });

    page = await context.newPage();

    // Stealth 스크립트 주입
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    });

    // 네이버 방문
    console.log('Step 1: Visiting Naver...');
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));

    // 쿠팡 검색
    console.log('Step 2: Searching for Coupang...');
    await page.locator('input[name="query"]').fill('쿠팡');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await new Promise(r => setTimeout(r, 3000));

    // 쿠팡 링크 찾기
    const coupangLink = page.locator('a:has-text("쿠팡")').first();
    const href = await coupangLink.getAttribute('href');
    console.log(`  Found link: ${href?.substring(0, 80)}...`);

    // 새 탭에서 쿠팡 열기
    console.log('Step 3: Opening Coupang...');
    const coupangPage = await context.newPage();
    await coupangPage.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};
    });

    await coupangPage.goto(href || 'https://www.coupang.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // 쿠팡에서 상품 검색 (자연스러운 타이핑)
    console.log('Step 4: Searching product on Coupang...');
    const searchInput = coupangPage.locator('#wa-search-form input.headerSearchKeyword');

    try {
      await searchInput.waitFor({ state: 'visible', timeout: 20000 });
      console.log('  Search input found!');

      // 자연스러운 타이핑 (한 글자씩)
      const searchText = '갤럭시25 자급제';
      await searchInput.click();
      await new Promise(r => setTimeout(r, 500));

      for (const char of searchText) {
        await searchInput.type(char, { delay: 80 + Math.random() * 120 });
        if (Math.random() < 0.1) {
          await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
        }
      }

      await new Promise(r => setTimeout(r, 1000));
      await coupangPage.keyboard.press('Enter');
      await coupangPage.waitForLoadState('domcontentloaded');
      await new Promise(r => setTimeout(r, 5000));

      // 검색 결과 확인
      const html = await coupangPage.content();
      const isChallenge = html.includes('Access Denied') ||
                          html.includes('location.reload') ||
                          (html.length < 5000 && html.includes('<script'));

      console.log(`\n결과:`);
      console.log(`  HTML 길이: ${html.length}`);
      console.log(`  차단/챌린지: ${isChallenge}`);

      if (isChallenge) {
        console.log('\n⚠️  검색 결과 페이지 차단됨');
        if (html.length < 1000) {
          console.log(`  HTML: ${html}`);
        }
      } else {
        // 상품 링크 찾기
        const productLinks = coupangPage.locator('a[href*="/vp/products/"]');
        const linkCount = await productLinks.count();
        console.log(`  상품 링크 수: ${linkCount}`);

        if (linkCount > 0) {
          console.log('\n✅ 검색 결과 페이지 정상 로드!');
          const firstLink = await productLinks.first().getAttribute('href');
          console.log(`  첫 번째 상품: ${firstLink?.substring(0, 80)}...`);
        }
      }
    } catch (error) {
      console.log(`  검색 입력 실패: ${error}`);
      const html = await coupangPage.content();
      console.log(`  현재 HTML 길이: ${html.length}`);
      if (html.length < 2000) {
        console.log(`  HTML: ${html}`);
      }
    }

    await coupangPage.close();
  }, 180000);

  /**
   * Firefox로 테스트 (Firefox는 webdriver 탐지가 다름)
   */
  it('should test with Firefox', async () => {
    console.log('\n=== Firefox Coupang Test ===\n');

    browser = await firefox.launch({ headless: false });
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
    });
    page = await context.newPage();

    // Firefox에서 webdriver 확인
    await page.goto('about:blank');
    const fingerprint = await page.evaluate(() => ({
      webdriver: navigator.webdriver,
      userAgent: navigator.userAgent,
    }));

    console.log('Firefox fingerprint:');
    console.log(`  webdriver: ${fingerprint.webdriver}`);
    console.log(`  userAgent: ${fingerprint.userAgent}`);

    // 쿠팡 직접 접속
    console.log('\nNavigating to Coupang...');
    await page.goto('https://www.coupang.com', { waitUntil: 'networkidle' });
    await new Promise(r => setTimeout(r, 10000));

    const html = await page.content();
    const isChallenge = html.includes('location.reload') ||
                        (html.length < 5000 && html.includes('<script'));

    console.log(`\n결과:`);
    console.log(`  HTML 길이: ${html.length}`);
    console.log(`  JS 챌린지 페이지: ${isChallenge}`);

    if (isChallenge) {
      console.log('\n⚠️  Firefox도 차단됨');
    } else {
      console.log('\n✅ Firefox로 접근 성공!');
    }
  }, 120000);
});
