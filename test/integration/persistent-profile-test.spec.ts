/**
 * Persistent Profile Test
 *
 * 조언 기반 봇 탐지 우회 테스트:
 * 1. 시크릿 모드 X - 실제 사용자 프로필 사용
 * 2. 랜덤 좌표 클릭 - 요소 범위 내 랜덤 위치
 * 3. 세션 유지 - Persistent Context
 *
 * 실행: npx jest test/integration/persistent-profile-test.spec.ts
 */

import { chromium, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// 사용자 프로필 저장 경로
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'browser-profile');

describe('Persistent Profile Coupang Test', () => {
  let context: BrowserContext;
  let page: Page;

  beforeAll(() => {
    // 프로필 디렉토리 생성
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }
  });

  afterEach(async () => {
    if (context) {
      await context.close().catch(() => {});
    }
  });

  /**
   * 요소 범위 내 랜덤 좌표 클릭
   */
  async function randomClick(page: Page, selector: string): Promise<void> {
    const element = page.locator(selector).first();
    const box = await element.boundingBox();

    if (!box) {
      throw new Error(`Element not found: ${selector}`);
    }

    // 요소 범위 내 랜덤 좌표 (가장자리 10% 제외)
    const padding = 0.1;
    const randomX = box.x + box.width * (padding + Math.random() * (1 - 2 * padding));
    const randomY = box.y + box.height * (padding + Math.random() * (1 - 2 * padding));

    console.log(`  Random click at (${randomX.toFixed(0)}, ${randomY.toFixed(0)}) in element ${selector}`);

    // 마우스 이동 후 클릭 (자연스러운 패턴)
    await page.mouse.move(randomX, randomY, { steps: 5 + Math.floor(Math.random() * 10) });
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
    await page.mouse.click(randomX, randomY);
  }

  /**
   * 자연스러운 타이핑 (한 글자씩 + 랜덤 딜레이)
   */
  async function humanType(page: Page, selector: string, text: string): Promise<void> {
    await randomClick(page, selector);
    await new Promise(r => setTimeout(r, 300 + Math.random() * 300));

    for (const char of text) {
      await page.keyboard.type(char, { delay: 50 + Math.random() * 150 });

      // 가끔 멈춤 (생각하는 시간)
      if (Math.random() < 0.1) {
        await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
      }
    }
  }

  /**
   * 랜덤 스크롤
   */
  async function randomScroll(page: Page): Promise<void> {
    const scrollAmount = 200 + Math.random() * 400;
    await page.mouse.wheel(0, scrollAmount);
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
  }

  /**
   * Persistent Context로 쿠팡 접근 테스트
   */
  it('should access Coupang with persistent profile', async () => {
    console.log('\n=== Persistent Profile Coupang Test ===\n');
    console.log(`Profile directory: ${USER_DATA_DIR}`);

    // Persistent Context 사용 (실제 사용자 프로필처럼)
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
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

    // 1. 네이버 방문
    console.log('Step 1: Visiting Naver...');
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // 랜덤 스크롤 (사람처럼)
    await randomScroll(page);

    // 2. 쿠팡 검색 (랜덤 좌표 클릭 + 자연스러운 타이핑)
    console.log('Step 2: Searching for Coupang...');
    await humanType(page, 'input[name="query"]', '쿠팡');
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // 3. 쿠팡 링크 찾기 (coupang.com 포함된 링크만)
    console.log('Step 3: Finding Coupang link...');
    let href: string | null = null;
    const allLinks = page.locator('a');
    const linkCount = await allLinks.count();

    for (let i = 0; i < linkCount; i++) {
      const linkHref = await allLinks.nth(i).getAttribute('href');
      if (linkHref && (linkHref.includes('coupang.com') || linkHref.includes('ader.naver.com'))) {
        const text = await allLinks.nth(i).textContent();
        if (text?.includes('쿠팡')) {
          href = linkHref;
          console.log(`  Found Coupang link: ${href?.substring(0, 60)}...`);
          break;
        }
      }
    }

    if (!href) {
      href = 'https://www.coupang.com';
      console.log('  Using default: https://www.coupang.com');
    }

    // 새 탭에서 쿠팡 열기
    const coupangPage = await context.newPage();
    await coupangPage.goto(href || 'https://www.coupang.com', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 5000 + Math.random() * 2000));

    // 4. 쿠팡에서 검색 결과 페이지로 URL 직접 이동
    console.log('Step 4: Navigating to search results via URL...');
    const searchQuery = encodeURIComponent('갤럭시25 자급제');
    const searchUrl = `https://www.coupang.com/np/search?component=&q=${searchQuery}&channel=user`;

    console.log(`  검색 URL: ${searchUrl}`);

    try {
      await coupangPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 2000));

      // 검색 후 URL 확인
      const currentUrl = coupangPage.url();
      console.log(`  검색 후 URL: ${currentUrl}`);

      // 검색 결과 확인
      const html = await coupangPage.content();
      const isBlocked = html.includes('Access Denied') || html.length < 5000;

      // HTML 파일로 저장
      const outputDir = path.join(process.cwd(), 'data', 'html-output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const htmlPath = path.join(outputDir, `coupang-search-${timestamp}.html`);
      fs.writeFileSync(htmlPath, html);
      console.log(`\n📄 HTML 저장됨: ${htmlPath}`);

      console.log(`\n결과:`);
      console.log(`  HTML 길이: ${html.length}`);
      console.log(`  차단 여부: ${isBlocked}`);

      if (isBlocked) {
        console.log('\n⚠️  검색 결과 페이지 차단됨');
        if (html.length < 1000) {
          console.log(`  HTML: ${html}`);
        }
      } else {
        const productLinks = coupangPage.locator('a[href*="/vp/products/"]');
        const linkCount = await productLinks.count();
        console.log(`  상품 링크 수: ${linkCount}`);

        if (linkCount > 0) {
          console.log('\n✅ 검색 결과 페이지 정상 로드!');
        }
      }
    } catch (error) {
      console.log(`  검색 실패: ${error}`);
      const html = await coupangPage.content();
      console.log(`  HTML 길이: ${html.length}`);
      if (html.length < 2000) {
        console.log(`  HTML: ${html}`);
      }
    }

    await coupangPage.close();
    await page.close();
  }, 180000);

  /**
   * 두 번째 실행 - 저장된 세션 재사용
   */
  it('should reuse saved session on second run', async () => {
    console.log('\n=== Second Run - Reusing Session ===\n');

    // 이전 실행에서 저장된 프로필 재사용
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};
    });

    page = await context.newPage();

    // 쿠팡 직접 접속 (저장된 쿠키 사용)
    console.log('Directly accessing Coupang (with saved cookies)...');
    await page.goto('https://www.coupang.com', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 5000));

    const html = await page.content();
    const isBlocked = html.includes('Access Denied') || html.length < 5000;

    console.log(`결과:`);
    console.log(`  HTML 길이: ${html.length}`);
    console.log(`  차단 여부: ${isBlocked}`);

    // 쿠키 확인
    const cookies = await context.cookies();
    const coupangCookies = cookies.filter(c => c.domain.includes('coupang'));
    console.log(`  저장된 쿠팡 쿠키: ${coupangCookies.length}개`);
    coupangCookies.slice(0, 5).forEach(c => {
      console.log(`    - ${c.name}: ${c.value.substring(0, 20)}...`);
    });

    if (!isBlocked) {
      console.log('\n✅ 저장된 세션으로 쿠팡 접근 성공!');
    }

    await page.close();
  }, 120000);
});
