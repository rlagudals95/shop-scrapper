import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, chromium, Page } from 'playwright';
import {
  ISiteBrowserClient,
  SiteFetchResult,
  ProxyConfig,
} from '@/domain/interfaces';

/**
 * 브라우저 클라이언트 설정
 */
export interface BrowserClientConfig {
  headless?: boolean;
  proxy?: ProxyConfig;
  userDataDir?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
}

/**
 * Coupang Browser Client
 *
 * Akamai Bot Manager 우회 전략:
 * 1. Residential Proxy (한국 가정용 IP)
 * 2. Stealth 스크립트 (navigator.webdriver 등)
 * 3. 자연스러운 트래픽 흐름 (네이버 → 쿠팡)
 * 4. 검색창 직접 타이핑 (URL 직접 접근 대신)
 * 5. JS 챌린지 재시도 로직
 */
export class CoupangBrowserClient implements ISiteBrowserClient {
  private static readonly SUPPORTED_DOMAINS = ['coupang.com', 'www.coupang.com'];

  protected context: BrowserContext | null = null;
  protected config: BrowserClientConfig = {};

  getSupportedDomains(): string[] {
    return CoupangBrowserClient.SUPPORTED_DOMAINS;
  }

  /**
   * 브라우저 초기화
   */
  async initialize(): Promise<void> {
    this.config = this.getDefaultConfig();

    const userDataDir =
      this.config.userDataDir || path.join(process.cwd(), 'data', 'browser-profile-coupang');

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: this.config.headless ?? false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      viewport: this.config.viewport || { width: 1920, height: 1080 },
      locale: this.config.locale || 'ko-KR',
      timezoneId: this.config.timezoneId || 'Asia/Seoul',
      ignoreHTTPSErrors: true,
    };

    if (this.config.proxy) {
      launchOptions.proxy = {
        server: this.config.proxy.server,
        username: this.config.proxy.username,
        password: this.config.proxy.password,
      };
    }

    this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);

    // Stealth 스크립트 주입
    await this.injectStealthScripts();
  }

  /**
   * 브라우저 컨텍스트 정리
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }

  /**
   * 쿠팡 검색 결과 페이지(Listing) 가져오기
   *
   * 전략:
   * 1. 네이버에서 '쿠팡' 검색 후 쿠팡 링크 클릭 (자연스러운 유입)
   * 2. 쿠팡 메인 페이지에서 JS 챌린지 통과 대기
   * 3. 검색창에 키워드 타이핑 후 검색
   * 4. 검색 결과 페이지 JS 챌린지 통과 대기
   */
  async getListingPage(keyword: string): Promise<SiteFetchResult> {
    if (!this.context) {
      return {
        html: '',
        url: '',
        success: false,
        error: 'Browser context not initialized. Call initialize() first.',
      };
    }

    let mainPage: Page | null = null;
    let searchPage: Page | null = null;

    try {
      // Step 1: 네이버에서 쿠팡 검색
      mainPage = await this.context.newPage();
      const coupangUrl = await this.findCoupangViaNaverSearch(mainPage);

      // Step 2: 쿠팡 메인 페이지 접근
      searchPage = await this.context.newPage();
      const mainResult = await this.navigateToCoupangMain(searchPage, coupangUrl);

      if (!mainResult.success) {
        return {
          html: mainResult.html,
          url: searchPage.url(),
          success: false,
          error: 'Failed to load Coupang main page',
          blocked: true,
        };
      }

      // Step 3: 검색창에서 검색
      const searchResult = await this.searchViaSearchBox(searchPage, keyword);

      // HTML 저장
      if (searchResult.success) {
        this.saveHtml(searchResult.html, `coupang-listing-${keyword}`);
      }

      return {
        html: searchResult.html,
        url: searchPage.url(),
        success: searchResult.success,
        error: searchResult.success ? undefined : 'Search result page blocked',
        blocked: !searchResult.success,
      };
    } catch (error) {
      return {
        html: '',
        url: searchPage?.url() || '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await mainPage?.close().catch(() => {});
      await searchPage?.close().catch(() => {});
    }
  }

  /**
   * 쿠팡 상품 상세 페이지(PDP) 가져오기
   */
  async getProductPage(url: string): Promise<SiteFetchResult> {
    if (!this.context) {
      return {
        html: '',
        url: '',
        success: false,
        error: 'Browser context not initialized. Call initialize() first.',
      };
    }

    let page: Page | null = null;

    try {
      page = await this.context.newPage();

      // 먼저 쿠팡 메인으로 이동 (세션 설정)
      const mainResult = await this.navigateToCoupangMain(page, 'https://www.coupang.com');
      if (!mainResult.success) {
        return {
          html: mainResult.html,
          url: page.url(),
          success: false,
          error: 'Failed to establish Coupang session',
          blocked: true,
        };
      }

      // PDP로 이동
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.randomDelay(3000, 5000);

      // JS 챌린지 대기
      const result = await this.waitForJsChallenge(page, {
        maxAttempts: 6,
        intervalMs: 5000,
        minHtmlLength: 5000,
      });

      if (result.success) {
        this.saveHtml(result.html, 'coupang-pdp');
      }

      return {
        html: result.html,
        url: page.url(),
        success: result.success,
        error: result.success ? undefined : 'PDP page blocked',
        blocked: !result.success,
      };
    } catch (error) {
      return {
        html: '',
        url: page?.url() || url,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await page?.close().catch(() => {});
    }
  }

  /**
   * 현재 IP 주소 확인
   */
  async getCurrentIP(): Promise<string | null> {
    if (!this.context) {
      return null;
    }

    const page = await this.context.newPage();
    try {
      await page.goto('https://api.ipify.org?format=json', { timeout: 30000 });
      const text = await page.textContent('body');
      const data = JSON.parse(text || '{}');
      return data.ip || null;
    } catch {
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * Residential Proxy가 설정되어 있는지 확인
   */
  hasProxy(): boolean {
    return !!this.config.proxy;
  }

  // ========== Private Methods ==========

  private getDefaultConfig(): BrowserClientConfig {
    return {
      headless: false,
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      userDataDir: path.join(process.cwd(), 'data', 'browser-profile-coupang'),
      proxy: CoupangBrowserClient.createBrightDataProxy(),
    };
  }

  /**
   * Stealth 스크립트 주입
   */
  private async injectStealthScripts(): Promise<void> {
    if (!this.context) return;

    await this.context.addInitScript(() => {
      // webdriver 속성 숨기기
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Chrome 객체 생성
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};

      // 언어 설정
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en'],
      });

      // plugins 배열 (빈 배열은 봇으로 탐지됨)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });

      // permissions
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = async (parameters) => {
        if (parameters.name === 'notifications') {
          return originalQuery(parameters);
        }
        return originalQuery(parameters);
      };
    });
  }

  /**
   * 네이버에서 쿠팡 검색하여 링크 찾기
   */
  private async findCoupangViaNaverSearch(page: Page): Promise<string> {
    // 네이버 방문
    await page.goto('https://www.naver.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await this.randomDelay(2000, 3000);

    // 쿠팡 검색
    await page.locator('input[name="query"]').fill('쿠팡');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await this.randomDelay(2000, 3000);

    // 쿠팡 링크 찾기
    const allLinks = page.locator('a');
    const linkCount = await allLinks.count();

    for (let i = 0; i < linkCount; i++) {
      const href = await allLinks.nth(i).getAttribute('href');
      if (href && (href.includes('coupang.com') || href.includes('ader.naver.com'))) {
        const text = await allLinks.nth(i).textContent();
        if (text?.includes('쿠팡')) {
          return href;
        }
      }
    }

    // 기본값
    return 'https://www.coupang.com';
  }

  /**
   * 쿠팡 메인 페이지로 이동 및 JS 챌린지 통과
   */
  private async navigateToCoupangMain(
    page: Page,
    url: string,
  ): Promise<{ html: string; success: boolean }> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
      // 네비게이션 에러는 무시 (JS 리다이렉트 등)
    }

    // JS 챌린지 통과 대기 - 더 긴 대기 시간
    const result = await this.waitForJsChallenge(page, {
      maxAttempts: 8,
      intervalMs: 5000,
      minHtmlLength: 5000,
    });

    return result;
  }

  /**
   * 검색창을 통한 검색
   */
  private async searchViaSearchBox(
    page: Page,
    keyword: string,
  ): Promise<{ html: string; success: boolean }> {
    try {
      // 검색창 찾기
      const searchInput = page.locator(
        'input.headerSearchKeyword, input[name="q"], input.SearchBox-input',
      );
      await searchInput.first().waitFor({ state: 'visible', timeout: 10000 });

      // 검색창 클릭
      await searchInput.first().click();
      await this.randomDelay(500, 1000);

      // 자연스러운 타이핑
      await this.naturalType(page, keyword);
      await this.randomDelay(1000, 1500);

      // Enter 키로 검색
      await page.keyboard.press('Enter');

      // 페이지 로드 대기
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await this.randomDelay(5000, 8000);

      // JS 챌린지 통과 대기
      return await this.waitForJsChallenge(page, {
        maxAttempts: 6,
        intervalMs: 5000,
        minHtmlLength: 5000,
      });
    } catch {
      // 검색창 실패 시 URL 직접 접근 (폴백)
      const searchQuery = encodeURIComponent(keyword);
      const searchUrl = `https://www.coupang.com/np/search?component=&q=${searchQuery}&channel=user`;

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.randomDelay(10000, 15000);

      return await this.waitForJsChallenge(page, {
        maxAttempts: 6,
        intervalMs: 5000,
        minHtmlLength: 5000,
      });
    }
  }

  /**
   * 랜덤 지연
   */
  private async randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise((r) => setTimeout(r, delay));
  }

  /**
   * 자연스러운 타이핑
   */
  private async naturalType(page: Page, text: string): Promise<void> {
    for (const char of text) {
      await page.keyboard.type(char, { delay: 80 + Math.random() * 120 });
      // 가끔 잠시 멈춤
      if (Math.random() < 0.15) {
        await this.randomDelay(200, 500);
      }
    }
  }

  /**
   * JS 챌린지 대기 (Akamai)
   */
  private async waitForJsChallenge(
    page: Page,
    options: {
      maxAttempts?: number;
      intervalMs?: number;
      minHtmlLength?: number;
      blockedKeywords?: string[];
    } = {},
  ): Promise<{ html: string; success: boolean }> {
    const {
      maxAttempts = 6,
      intervalMs = 5000,
      minHtmlLength = 5000,
      blockedKeywords = ['Access Denied'],
    } = options;

    let html = '';
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise((r) => setTimeout(r, intervalMs));

      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        html = await page.content();

        // 충분한 HTML이 로드되었고 차단되지 않음
        const isBlocked = blockedKeywords.some((kw) => html.includes(kw));
        if (html.length > minHtmlLength && !isBlocked) {
          return { html, success: true };
        }
      } catch {
        // 재시도
      }
    }

    return { html, success: html.length > minHtmlLength };
  }

  /**
   * HTML 저장
   */
  private saveHtml(html: string, prefix: string): string {
    const outputDir = path.join(process.cwd(), 'data', 'html-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePrefix = prefix.replace(/[^a-zA-Z0-9가-힣-]/g, '_');
    const htmlPath = path.join(outputDir, `${safePrefix}-${timestamp}.html`);
    fs.writeFileSync(htmlPath, html);

    return htmlPath;
  }

  /**
   * Bright Data Proxy 설정 생성
   */
  static createBrightDataProxy(options?: {
    customerId?: string;
    zone?: string;
    port?: string;
    apiKey?: string;
  }): ProxyConfig | undefined {
    const apiKey = options?.apiKey || process.env.BRIGHT_DATA_API_KEY;
    if (!apiKey) {
      return undefined;
    }

    const customerId = options?.customerId || process.env.BRIGHT_DATA_CUSTOMER_ID || 'hl_8b7f0cc7';
    const zone = options?.zone || process.env.BRIGHT_DATA_ZONE || 'residential_proxy1';
    const port = options?.port || process.env.BRIGHT_DATA_PORT || '33335';

    return {
      server: `http://brd.superproxy.io:${port}`,
      username: `brd-customer-${customerId}-zone-${zone}`,
      password: apiKey,
    };
  }

  // ========== Static Factory Methods ==========

  /**
   * Proxy와 함께 초기화
   */
  static async createWithProxy(): Promise<CoupangBrowserClient> {
    const client = new CoupangBrowserClient();
    const proxy = CoupangBrowserClient.createBrightDataProxy();

    if (!proxy) {
      throw new Error('BRIGHT_DATA_API_KEY environment variable is required for proxy');
    }

    client.config = {
      ...client.getDefaultConfig(),
      proxy,
    };
    await client.initialize();
    return client;
  }

  /**
   * Proxy 없이 초기화 (테스트용)
   */
  static async createWithoutProxy(): Promise<CoupangBrowserClient> {
    const client = new CoupangBrowserClient();
    client.config = {
      ...client.getDefaultConfig(),
      proxy: undefined,
    };
    await client.initialize();
    return client;
  }
}
