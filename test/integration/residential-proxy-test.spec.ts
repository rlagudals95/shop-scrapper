/**
 * Bright Data Residential Proxy Test
 *
 * Residential Proxy의 IP는 실제 가정용 IP로, 봇 탐지 우회에 효과적
 *
 * 실행: PROXY_ENABLED=true npx jest test/integration/residential-proxy-test.spec.ts
 */

import { chromium, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// Bright Data Proxy 설정
const PROXY_HOST = 'brd.superproxy.io';
const PROXY_PORT = process.env.BRIGHT_DATA_PORT || '33335';
const PROXY_USERNAME = `brd-customer-${process.env.BRIGHT_DATA_CUSTOMER_ID || 'hl_8b7f0cc7'}-zone-${process.env.BRIGHT_DATA_ZONE || 'residential_proxy1'}`;
const PROXY_PASSWORD = process.env.BRIGHT_DATA_API_KEY || '';

describe('Residential Proxy Coupang Test', () => {
  let context: BrowserContext;
  let page: Page;

  afterEach(async () => {
    if (context) {
      await context.close().catch(() => {});
    }
  });

  /**
   * Residential Proxy로 쿠팡 검색 결과 페이지 접근
   */
  it('should access Coupang search with residential proxy', async () => {
    console.log('\n=== Residential Proxy Coupang Test ===\n');

    if (!PROXY_PASSWORD) {
      console.log('⚠️ BRIGHT_DATA_API_KEY not set. Skipping test.');
      return;
    }

    const proxyServer = `http://${PROXY_HOST}:${PROXY_PORT}`;
    console.log(`Proxy: ${proxyServer}`);
    console.log(`Username: ${PROXY_USERNAME.substring(0, 40)}...`);

    // Persistent Context 사용 + Proxy
    const userDataDir = path.join(process.cwd(), 'data', 'browser-profile-proxy');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      proxy: {
        server: proxyServer,
        username: PROXY_USERNAME,
        password: PROXY_PASSWORD,
      },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      ignoreHTTPSErrors: true,
    });

    // Stealth 스크립트 주입
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    });

    page = await context.newPage();

    // 1. IP 확인
    console.log('Step 1: Checking IP address...');
    try {
      await page.goto('https://api.ipify.org?format=json', { timeout: 30000 });
      const ipText = await page.textContent('body');
      console.log(`  Current IP: ${ipText}`);
    } catch (e) {
      console.log(`  IP check failed: ${e}`);
    }

    // 2. 네이버 방문
    console.log('\nStep 2: Visiting Naver...');
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // 3. 쿠팡 검색
    console.log('Step 3: Searching for Coupang...');
    await page.locator('input[name="query"]').fill('쿠팡');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // 4. 쿠팡 링크 찾기
    console.log('Step 4: Finding Coupang link...');
    let href: string | null = null;
    const allLinks = page.locator('a');
    const linkCount = await allLinks.count();

    for (let i = 0; i < linkCount; i++) {
      const linkHref = await allLinks.nth(i).getAttribute('href');
      if (linkHref && (linkHref.includes('coupang.com') || linkHref.includes('ader.naver.com'))) {
        const text = await allLinks.nth(i).textContent();
        if (text?.includes('쿠팡')) {
          href = linkHref;
          console.log(`  Found: ${href?.substring(0, 60)}...`);
          break;
        }
      }
    }

    if (!href) {
      href = 'https://www.coupang.com';
      console.log('  Using default: https://www.coupang.com');
    }

    // 5. 쿠팡 메인 페이지
    console.log('\nStep 5: Navigating to Coupang main...');
    const coupangPage = await context.newPage();

    try {
      await coupangPage.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      console.log(`  Navigation error (expected): ${e}`);
    }

    // JS 챌린지/리다이렉트 대기 - 반복 확인
    console.log('  Waiting for page to stabilize...');
    let mainHtml = '';
    let mainAttempts = 0;
    const maxMainAttempts = 8;

    while (mainAttempts < maxMainAttempts) {
      mainAttempts++;
      await new Promise(r => setTimeout(r, 5000));

      try {
        await coupangPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        mainHtml = await coupangPage.content();
        console.log(`  Main attempt ${mainAttempts}: HTML length = ${mainHtml.length}`);

        // 충분한 HTML이 로드됨
        if (mainHtml.length > 5000 && !mainHtml.includes('Access Denied')) {
          console.log('  ✅ Main page loaded');
          break;
        }

        // JS 챌린지 페이지인 경우 더 기다림
        if (mainHtml.length < 2000 && mainHtml.includes('<script')) {
          console.log('  JS challenge processing...');
        }
      } catch (e) {
        console.log(`  Main attempt ${mainAttempts}: Error - ${e}`);
      }
    }

    if (mainHtml.length < 5000) {
      console.log('  ⚠️ Main page failed');
      return;
    }

    // 6. 검색창을 통해 검색 (URL 직접 접근 대신)
    console.log('\nStep 6: Searching via search box...');

    try {
      // 검색창 찾기
      const searchInput = coupangPage.locator('input.headerSearchKeyword, input[name="q"], input.SearchBox-input');
      await searchInput.first().waitFor({ state: 'visible', timeout: 10000 });
      console.log('  Found search input');

      // 검색창 클릭
      await searchInput.first().click();
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

      // 자연스러운 타이핑
      const searchText = '갤럭시25 자급제';
      for (const char of searchText) {
        await coupangPage.keyboard.type(char, { delay: 80 + Math.random() * 120 });
        if (Math.random() < 0.15) {
          await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
        }
      }
      console.log('  Typed search query');

      await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));

      // Enter 키로 검색
      await coupangPage.keyboard.press('Enter');
      console.log('  Pressed Enter');

      // 페이지 로드 대기
      await coupangPage.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 3000));

    } catch (e) {
      console.log(`  Search box method failed: ${e}`);
      console.log('  Falling back to URL navigation...');

      const searchQuery = encodeURIComponent('갤럭시25 자급제');
      const searchUrl = `https://www.coupang.com/np/search?component=&q=${searchQuery}&channel=user`;
      await coupangPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(r => setTimeout(r, 10000));
    }

    // JS 챌린지 처리 - 반복 확인
    console.log('  Waiting for page to stabilize...');
    let searchHtml = '';
    let attempts = 0;
    const maxAttempts = 6;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        await coupangPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));

        searchHtml = await coupangPage.content();
        console.log(`  Attempt ${attempts}: HTML length = ${searchHtml.length}`);

        // 충분한 HTML이 로드됨
        if (searchHtml.length > 5000 && !searchHtml.includes('Access Denied')) {
          console.log('  Page loaded successfully!');
          break;
        }

        // 아직 로딩 중
        if (searchHtml.length < 5000) {
          console.log('  Still loading, waiting more...');
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (e) {
        console.log(`  Attempt ${attempts}: Error - ${e}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // 결과 확인
    const currentUrl = coupangPage.url();

    console.log(`\n결과:`);
    console.log(`  URL: ${currentUrl}`);
    console.log(`  HTML 길이: ${searchHtml.length}`);

    // HTML 저장
    const outputDir = path.join(process.cwd(), 'data', 'html-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const htmlPath = path.join(outputDir, `residential-proxy-${timestamp}.html`);
    fs.writeFileSync(htmlPath, searchHtml);
    console.log(`  📄 HTML 저장됨: ${htmlPath}`);

    const isBlocked = searchHtml.includes('Access Denied') || searchHtml.length < 5000;
    console.log(`  차단 여부: ${isBlocked}`);

    if (isBlocked) {
      console.log('\n⚠️ 검색 결과 페이지 차단됨');
      if (searchHtml.length < 1000) {
        console.log(`  HTML: ${searchHtml}`);
      }
    } else {
      const productLinks = coupangPage.locator('a[href*="/vp/products/"]');
      const productCount = await productLinks.count();
      console.log(`  상품 링크 수: ${productCount}`);

      if (productCount > 0) {
        console.log('\n✅ 검색 결과 페이지 정상 로드!');
      }
    }

    await coupangPage.close();
    await page.close();
  }, 300000);
});
