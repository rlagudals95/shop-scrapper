/**
 * Puppeteer Stealth Test - undetected-chromedriver 방식
 *
 * puppeteer-extra-plugin-stealth 사용
 * - evasions: webdriver, chrome.runtime, navigator.plugins 등 자동 우회
 *
 * 실행: npx jest test/integration/puppeteer-stealth-test.spec.ts
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
import { Browser, Page } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';

// Stealth 플러그인 추가
puppeteer.use(StealthPlugin());

describe('Puppeteer Stealth Coupang Test', () => {
  let browser: Browser;
  let page: Page;

  afterEach(async () => {
    if (browser) {
      await browser.close().catch(() => {});
    }
  });

  /**
   * Stealth 모드로 쿠팡 검색 결과 페이지 접근
   */
  it('should access Coupang search with puppeteer-stealth', async () => {
    console.log('\n=== Puppeteer Stealth Coupang Test ===\n');

    // 브라우저 실행 (Stealth 플러그인 자동 적용)
    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--lang=ko-KR',
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
    });

    page = await browser.newPage();

    // 한국어 설정
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // Stealth 확인
    console.log('Checking stealth settings...');
    await page.goto('about:blank');
    const stealthCheck = await page.evaluate(() => ({
      webdriver: navigator.webdriver,
      // @ts-ignore
      chromeRuntime: !!window.chrome?.runtime,
      plugins: navigator.plugins.length,
      languages: navigator.languages,
    }));

    console.log('Stealth check:');
    console.log(`  webdriver: ${stealthCheck.webdriver}`);
    console.log(`  chrome.runtime: ${stealthCheck.chromeRuntime}`);
    console.log(`  plugins: ${stealthCheck.plugins}`);
    console.log(`  languages: ${JSON.stringify(stealthCheck.languages)}`);

    // 1. 네이버 방문
    console.log('\nStep 1: Visiting Naver...');
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // 2. 쿠팡 검색
    console.log('Step 2: Searching for Coupang...');
    await page.type('input[name="query"]', '쿠팡', { delay: 100 + Math.random() * 100 });
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // 3. 쿠팡 링크 찾기
    console.log('Step 3: Finding Coupang link...');
    const links = await page.$$('a');
    let coupangHref: string | null = null;

    for (const link of links) {
      const href = await link.evaluate(el => el.getAttribute('href'));
      const text = await link.evaluate(el => el.textContent);
      if (href && (href.includes('coupang.com') || href.includes('ader.naver.com'))) {
        if (text?.includes('쿠팡')) {
          coupangHref = href;
          console.log(`  Found: ${href.substring(0, 60)}...`);
          break;
        }
      }
    }

    if (!coupangHref) {
      coupangHref = 'https://www.coupang.com';
      console.log('  Using default: https://www.coupang.com');
    }

    // 4. 쿠팡 메인 페이지로 이동
    console.log('Step 4: Navigating to Coupang main...');
    await page.goto(coupangHref, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000 + Math.random() * 2000));

    // 쿠팡 메인 페이지 확인
    const mainPageHtml = await page.content();
    console.log(`  Main page HTML length: ${mainPageHtml.length}`);

    if (mainPageHtml.includes('Access Denied') || mainPageHtml.length < 5000) {
      console.log('  ⚠️ Main page blocked!');
      console.log(`  HTML: ${mainPageHtml.substring(0, 500)}`);
      return;
    }

    console.log('  ✅ Main page loaded successfully');

    // 5. 검색 결과 페이지로 이동
    console.log('Step 5: Navigating to search results...');
    const searchQuery = encodeURIComponent('갤럭시25 자급제');
    const searchUrl = `https://www.coupang.com/np/search?component=&q=${searchQuery}&channel=user`;

    console.log(`  Search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000 + Math.random() * 2000));

    // 검색 결과 확인
    const searchHtml = await page.content();
    const currentUrl = page.url();

    console.log(`\n결과:`);
    console.log(`  URL: ${currentUrl}`);
    console.log(`  HTML 길이: ${searchHtml.length}`);

    // HTML 저장
    const outputDir = path.join(process.cwd(), 'data', 'html-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const htmlPath = path.join(outputDir, `puppeteer-stealth-${timestamp}.html`);
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
      // 상품 링크 확인
      const productLinks = await page.$$('a[href*="/vp/products/"]');
      console.log(`  상품 링크 수: ${productLinks.length}`);

      if (productLinks.length > 0) {
        console.log('\n✅ 검색 결과 페이지 정상 로드!');
      }
    }
  }, 180000);

  /**
   * Stealth 모드 + 타이핑으로 검색
   */
  it('should search with typing using puppeteer-stealth', async () => {
    console.log('\n=== Puppeteer Stealth with Typing ===\n');

    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--lang=ko-KR',
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });

    page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // 1. 네이버 → 쿠팡 메인
    console.log('Step 1: Naver → Coupang main...');
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));

    await page.type('input[name="query"]', '쿠팡', { delay: 150 });
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));

    // 쿠팡 링크 찾기
    const links = await page.$$('a');
    let coupangHref = 'https://www.coupang.com';

    for (const link of links) {
      const href = await link.evaluate(el => el.getAttribute('href'));
      const text = await link.evaluate(el => el.textContent);
      if (href && (href.includes('coupang.com') || href.includes('ader.naver.com'))) {
        if (text?.includes('쿠팡')) {
          coupangHref = href;
          break;
        }
      }
    }

    await page.goto(coupangHref, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // 2. 쿠팡에서 검색 (타이핑)
    console.log('Step 2: Typing search on Coupang...');

    try {
      // 검색창 찾기
      await page.waitForSelector('input.headerSearchKeyword, input[name="q"]', { timeout: 20000 });
      const searchInput = await page.$('input.headerSearchKeyword') || await page.$('input[name="q"]');

      if (searchInput) {
        // 검색창 클릭 후 타이핑
        await searchInput.click();
        await new Promise(r => setTimeout(r, 500));

        // 자연스러운 타이핑
        const searchText = '갤럭시25 자급제';
        for (const char of searchText) {
          await page.keyboard.type(char, { delay: 80 + Math.random() * 120 });
          if (Math.random() < 0.1) {
            await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
          }
        }

        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.press('Enter');

        // 페이지 로드 대기
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 5000));

        // 결과 확인
        const html = await page.content();
        const currentUrl = page.url();

        console.log(`\n결과:`);
        console.log(`  URL: ${currentUrl}`);
        console.log(`  HTML 길이: ${html.length}`);

        const isBlocked = html.includes('Access Denied') || html.length < 5000;
        console.log(`  차단 여부: ${isBlocked}`);

        // HTML 저장
        const outputDir = path.join(process.cwd(), 'data', 'html-output');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const htmlPath = path.join(outputDir, `puppeteer-typing-${timestamp}.html`);
        fs.writeFileSync(htmlPath, html);
        console.log(`  📄 HTML 저장됨: ${htmlPath}`);

        if (isBlocked) {
          console.log('\n⚠️ 차단됨');
          if (html.length < 1000) {
            console.log(`  HTML: ${html}`);
          }
        } else {
          const productLinks = await page.$$('a[href*="/vp/products/"]');
          console.log(`  상품 링크 수: ${productLinks.length}`);

          if (productLinks.length > 0) {
            console.log('\n✅ 검색 성공!');
          }
        }
      }
    } catch (error) {
      console.log(`  Error: ${error}`);
    }
  }, 180000);
});
