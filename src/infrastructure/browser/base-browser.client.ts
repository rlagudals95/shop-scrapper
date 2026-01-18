import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, chromium, Page } from 'playwright';
import {
  BrowserClientConfig,
  ISiteBrowserClient,
  PageResult,
  ProxyConfig,
} from './browser-client.interface';

/**
 * 브라우저 클라이언트 기본 추상 클래스
 *
 * 공통 기능:
 * - Stealth 스크립트 주입
 * - 지연 함수
 * - 브라우저 컨텍스트 관리
 * - HTML 저장
 */
export abstract class BaseBrowserClient implements ISiteBrowserClient {
  protected context: BrowserContext | null = null;
  protected config: BrowserClientConfig = {};

  /**
   * 사이트별 기본 설정
   */
  protected abstract getDefaultConfig(): BrowserClientConfig;

  /**
   * 지원하는 도메인 목록
   */
  abstract getSupportedDomains(): string[];

  /**
   * Listing 페이지 가져오기 (사이트별 구현)
   */
  abstract getListingPage(keyword: string): Promise<PageResult>;

  /**
   * 상품 상세 페이지 가져오기 (사이트별 구현)
   */
  abstract getProductPage(url: string): Promise<PageResult>;

  /**
   * 브라우저 초기화
   */
  async initialize(config?: BrowserClientConfig): Promise<void> {
    this.config = { ...this.getDefaultConfig(), ...config };

    const userDataDir = this.config.userDataDir || this.getDefaultUserDataDir();

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
    } catch (e) {
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * 기본 User Data 디렉토리 경로
   */
  protected getDefaultUserDataDir(): string {
    return path.join(process.cwd(), 'data', 'browser-profile');
  }

  /**
   * Stealth 스크립트 주입
   */
  protected async injectStealthScripts(): Promise<void> {
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
          // 원본 쿼리 결과를 반환하여 타입 안전성 유지
          return originalQuery(parameters);
        }
        return originalQuery(parameters);
      };
    });
  }

  /**
   * 랜덤 지연
   */
  protected async randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise((r) => setTimeout(r, delay));
  }

  /**
   * 자연스러운 타이핑
   */
  protected async naturalType(page: Page, text: string): Promise<void> {
    for (const char of text) {
      await page.keyboard.type(char, { delay: 80 + Math.random() * 120 });
      // 가끔 잠시 멈춤
      if (Math.random() < 0.15) {
        await this.randomDelay(200, 500);
      }
    }
  }

  /**
   * HTML 저장
   */
  protected saveHtml(html: string, prefix: string): string {
    const outputDir = path.join(process.cwd(), 'data', 'html-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const htmlPath = path.join(outputDir, `${prefix}-${timestamp}.html`);
    fs.writeFileSync(htmlPath, html);

    return htmlPath;
  }

  /**
   * JS 챌린지 대기 (Akamai, Cloudflare 등)
   */
  protected async waitForJsChallenge(
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
      } catch (e) {
        // 재시도
      }
    }

    return { html, success: html.length > minHtmlLength };
  }

  /**
   * Proxy 설정 생성 (Bright Data용)
   */
  protected static createBrightDataProxy(options?: {
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
}
