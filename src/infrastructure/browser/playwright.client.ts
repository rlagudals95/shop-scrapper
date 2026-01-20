import { CrawlException, createLogger } from '@/common';
import {
  CoupangProductDetail,
  CoupangSearchResult,
  CoupangVendorItemResult,
  FetchOptions,
  FetchResult,
  IBrowserClient,
  ProxyConfig,
  SITE_CONFIGS,
  SiteConfig,
} from '@/domain/interfaces';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Browser, BrowserContext, Cookie, Page, firefox, chromium } from 'playwright';

/** Minimum HTML length to consider the response valid (not a blocked/empty page) */
const MIN_VALID_HTML_LENGTH = 5000;

/** Keywords that indicate a blocked or invalid response */
const BLOCKED_INDICATORS = [
  'access denied',
  'blocked',
  'captcha',
  'robot',
  'unusual traffic',
  '접근이 거부',
  '차단',
  '비정상적인 트래픽',
  'please verify',
  '확인해 주세요',
  'are you a human',
  '보안 확인',
];

/** Firefox User Agents (최신 버전) - Firefox가 Chrome보다 탐지 회피율이 높음 */
const FIREFOX_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
];

/** 일반적인 데스크톱 해상도 */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
];

@Injectable()
export class PlaywrightClient implements IBrowserClient, OnModuleDestroy {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly logger = createLogger(PlaywrightClient.name);
  private readonly defaultHeadless: boolean;
  private readonly timeout: number;
  /** Track which domains have been warmed up in this session */
  private warmedUpDomains: Set<string> = new Set();
  /** Directory for storing cookies */
  private readonly cookieDir: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultHeadless = this.configService.get<boolean>(
      'browser.headless',
      false, // 기본값 false (Headless는 탐지에 취약)
    );
    this.timeout = this.configService.get<number>('browser.timeout', 120000); // 2분
    // Cookie storage directory (default: ./data/cookies)
    this.cookieDir = this.configService.get<string>(
      'browser.cookieDir',
      path.join(process.cwd(), 'data', 'cookies'),
    );
    // Ensure cookie directory exists
    if (!fs.existsSync(this.cookieDir)) {
      fs.mkdirSync(this.cookieDir, { recursive: true });
    }
  }

  async onModuleDestroy() {
    await this.close();
  }

  /**
   * Get a random Firefox user agent
   */
  private getRandomUserAgent(): string {
    return FIREFOX_USER_AGENTS[Math.floor(Math.random() * FIREFOX_USER_AGENTS.length)];
  }

  /**
   * Get a random viewport size
   */
  private getRandomViewport(): { width: number; height: number } {
    return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  }

  /**
   * Firefox 브라우저 실행 (봇 탐지 회피율이 높음)
   */
  private async ensureBrowser(
    forceHeadful: boolean = false,
    proxy?: ProxyConfig,
  ): Promise<BrowserContext> {
    if (!this.browser) {
      const headless = forceHeadful ? false : this.defaultHeadless;
      
      this.logger.log(`Launching Firefox (headless: ${headless})...`);

      // Firefox 전용 설정
      const firefoxOptions: any = {
        headless,
        firefoxUserPrefs: {
          'dom.webdriver.enabled': false,              // WebDriver API 완전 비활성화
          'privacy.resistFingerprinting': false,       // 핑거프린팅 저항 끄기
          'network.http.referer.spoofSource': true,    // Referer 스푸핑 허용
          'media.navigator.enabled': false,            // 미디어 장치 열거 비활성화
          'network.cookie.cookieBehavior': 0,          // 모든 쿠키 허용
          'browser.cache.disk.enable': true,
          'browser.cache.memory.enable': true,
        },
      };

      // 프록시 사용 시 SSL 인증서 검증 무시 설정
      if (proxy) {
        firefoxOptions.ignoreHTTPSErrors = true;
      }

      if (proxy) {
        // Playwright 프록시 형식: server는 http:// 프로토콜 필요 (Bright Data 문서 참고)
        const proxyServer = proxy.server.startsWith('http')
          ? proxy.server
          : `http://${proxy.server}`;

        firefoxOptions.proxy = {
          server: proxyServer,
          username: proxy.username,
          password: proxy.password,
        };
        this.logger.log(`Proxy configured in ensureBrowser: ${proxyServer} (user: ${proxy.username?.substring(0, 30)}...)`);
      }

      this.browser = await firefox.launch(firefoxOptions);

      const userAgent = this.getRandomUserAgent();
      const viewport = this.getRandomViewport();

      this.context = await this.browser.newContext({
        userAgent,
        viewport,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        geolocation: { latitude: 37.5665, longitude: 126.978 },
        permissions: ['geolocation'],
        extraHTTPHeaders: this.getFirefoxHeaders(userAgent),
        ignoreHTTPSErrors: !!proxy, // 프록시 사용 시 SSL 인증서 오류 무시
      });

      // WebDriver 감지 우회 스크립트 주입 (Reference 기반 강화)
      await this.context.addInitScript(() => {
        // WebDriver 속성 완전 제거
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        // Plugins 모킹
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Languages 설정
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        });

        // Chrome 객체 제거 (Firefox에서는 없어야 함)
        if ((window as any).chrome) {
          delete (window as any).chrome;
        }

        // Permissions API 모킹
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery(parameters);

        // Canvas 핑거프린팅 우회
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: any) {
          const context = this.getContext('2d');
          if (context) {
            // 미세한 노이즈 추가 (탐지 방지)
            const imageData = context.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
              if (Math.random() < 0.001) {
                imageData.data[i] = Math.min(255, imageData.data[i] + Math.floor(Math.random() * 3) - 1);
              }
            }
            context.putImageData(imageData, 0, 0);
          }
          return originalToDataURL.apply(this, arguments as any);
        };

        // WebGL 핑거프린팅 우회
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
          if (parameter === 37445) {
            // UNMASKED_VENDOR_WEBGL
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            // UNMASKED_RENDERER_WEBGL
            return 'Intel Iris OpenGL Engine';
          }
          return getParameter.apply(this, arguments as any);
        };
      });
    }

    return this.context!;
  }

  /**
   * Firefox용 HTTP 헤더
   */
  private getFirefoxHeaders(userAgent: string): Record<string, string> {
    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    };
  }

  /**
   * 자연스러운 딜레이 (가변적이고 더 긴 범위)
   */
  private async randomDelay(minMs: number = 2000, maxMs: number = 5000): Promise<void> {
    // 인간의 행동 패턴: 가끔 더 긴 대기, 가끔 짧은 대기
    const baseDelay = minMs + Math.random() * (maxMs - minMs);
    // 10% 확률로 더 긴 대기 (사람이 페이지를 읽는 시간)
    const extendedDelay = Math.random() < 0.1 ? baseDelay * (1.5 + Math.random() * 0.5) : baseDelay;
    const delay = Math.floor(extendedDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 인간형 텍스트 입력 (한 글자씩 입력, 자연스러운 딜레이)
   */
  private async humanType(
    page: Page,
    selector: string,
    text: string,
    options?: { delay?: number; clearFirst?: boolean },
  ): Promise<void> {
    const locator = page.locator(selector).first();
    await locator.click({ delay: 100 + Math.random() * 200 });
    await this.randomDelay(300, 800);

    if (options?.clearFirst) {
      await locator.clear();
      await this.randomDelay(100, 300);
    }

    // 한 글자씩 입력 (인간의 타이핑 속도 시뮬레이션)
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const baseDelay = options?.delay || (80 + Math.random() * 120); // 80-200ms per char
      // 가끔 오타 후 수정 (5% 확률)
      if (Math.random() < 0.05 && i > 0) {
        await page.keyboard.press('Backspace');
        await this.randomDelay(50, 150);
      }
      await locator.type(char, { delay: baseDelay });
      // 가끔 멈춤 (사람이 생각하는 시간)
      if (Math.random() < 0.1) {
        await this.randomDelay(200, 600);
      }
    }
    await this.randomDelay(300, 800);
  }

  /**
   * 자연스러운 마우스 움직임 (요소로 이동)
   */
  private async moveMouseToElement(page: Page, selector: string): Promise<void> {
    const locator = page.locator(selector).first();
    const box = await locator.boundingBox();
    if (box) {
      // 요소 중심으로 마우스 이동 (곡선 경로 시뮬레이션)
      const steps = 5 + Math.floor(Math.random() * 5);
      const startX = Math.random() * 100;
      const startY = Math.random() * 100;
      const endX = box.x + box.width / 2;
      const endY = box.y + box.height / 2;

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // 베지어 곡선으로 자연스러운 이동
        const x = startX + (endX - startX) * t + Math.sin(t * Math.PI) * (Math.random() * 20 - 10);
        const y = startY + (endY - startY) * t + Math.sin(t * Math.PI) * (Math.random() * 20 - 10);
        await page.mouse.move(x, y);
        await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 30));
      }
      await this.randomDelay(100, 300);
    }
  }

  /**
   * 복잡한 스크롤 패턴 (여러 번 스크롤, 위아래 이동)
   */
  private async humanScroll(page: Page, iterations: number = 3): Promise<void> {
    for (let i = 0; i < iterations; i++) {
      // 아래로 스크롤
      const scrollDown = 200 + Math.random() * 400;
      await page.evaluate((amount) => {
        window.scrollBy({
          top: amount,
          behavior: 'smooth',
        });
      }, scrollDown);
      await this.randomDelay(800, 1500);

      // 가끔 위로 조금 스크롤 (사람이 다시 확인하는 패턴)
      if (Math.random() < 0.3) {
        const scrollUp = 50 + Math.random() * 100;
        await page.evaluate((amount) => {
          window.scrollBy({
            top: -amount,
            behavior: 'smooth',
          });
        }, scrollUp);
        await this.randomDelay(400, 800);
      }
    }
  }

  /**
   * 네이버 경유 쿠팡 접근 플로우 (Reference 기반)
   * 1. 네이버 접속
   * 2. 네이버에서 "쿠팡" 검색
   * 3. 쿠팡 링크 URL 추출 후 새 탭에서 열기
   * 4. 쿠팡에서 상품 키워드 검색
   * 5. 검색 결과에서 첫 번째 상품 클릭
   */
  private async navigateViaNaverToCoupang(
    page: Page,
    targetUrl: string,
    siteConfig: SiteConfig,
    productKeyword?: string,
    timeout?: number,
  ): Promise<Page> {
    const pageTimeout = timeout ?? this.timeout;

    // 1. 네이버 접속
    this.logger.log('Step 1: Visiting Naver...');
    await page.goto('https://www.naver.com', {
      waitUntil: 'load',
      timeout: pageTimeout,
    });
    await page.waitForLoadState('domcontentloaded');
    await this.randomDelay(2000, 3000);

    // 2. 네이버에서 "쿠팡" 검색 (인간형 패턴)
    const naverKeyword = siteConfig.naverSearchKeyword || '쿠팡';
    this.logger.log(`Step 2: Searching "${naverKeyword}" on Naver...`);
    
    // 검색창으로 마우스 이동
    await this.moveMouseToElement(page, 'input[name="query"]');
    
    // 인간형 입력
    await this.humanType(page, 'input[name="query"]', naverKeyword, { clearFirst: false });
    
    await this.randomDelay(500, 1000);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('load');
    await this.randomDelay(2000, 4000);

    // 3. 네이버 검색 결과에서 쿠팡 링크 URL 추출 (Reference 패턴)
    this.logger.log('Step 3: Extracting Coupang URL from Naver search results...');
    let coupangUrl: string | null = null;

    try {
      // 네이버 검색 결과에서 유효한 쿠팡 링크 찾기
      const coupangLinks = page.locator('a:has-text("쿠팡")');
      const count = await coupangLinks.count();
      this.logger.log(`Found ${count} links with "쿠팡" text`);

      for (let i = 0; i < count && !coupangUrl; i++) {
        const href = await coupangLinks.nth(i).getAttribute('href');
        // 유효한 URL만 사용 (http로 시작하거나 coupang.com 포함)
        if (href && (href.startsWith('http') || href.includes('coupang.com'))) {
          coupangUrl = href;
          this.logger.log(`Found valid Coupang URL at index ${i}: ${coupangUrl}`);
          break;
        }
      }

      if (!coupangUrl) {
        this.logger.warn('No valid Coupang link found in search results, using default URL');
        coupangUrl = 'https://www.coupang.com';
      }
    } catch {
      this.logger.warn('Coupang link extraction failed, using default URL');
      coupangUrl = 'https://www.coupang.com';
    }

    // 4. 새 탭에서 쿠팡 페이지 열기 (Reference 패턴 - 중요!)
    this.logger.log('Step 4: Opening Coupang in new tab...');
    const coupangPage = await this.context!.newPage();

    // Reference 패턴: 페이지마다 안티 탐지 스크립트 주입 (강화)
    await coupangPage.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
      
      // Chrome 객체 제거
      if (window.chrome) {
        delete window.chrome;
      }
      
      // Canvas 핑거프린팅 우회
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        const context = this.getContext('2d');
        if (context) {
          const imageData = context.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            if (Math.random() < 0.001) {
              imageData.data[i] = Math.min(255, imageData.data[i] + Math.floor(Math.random() * 3) - 1);
            }
          }
          context.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, arguments);
      };
    `);

    await coupangPage.goto(coupangUrl, {
      waitUntil: 'load',
      timeout: pageTimeout,
    });
    await coupangPage.waitForLoadState('domcontentloaded');
    await this.randomDelay(5000, 7000);

    // 5. 쿠팡에서 상품 키워드 검색 (Reference 셀렉터 사용)
    const searchKeyword = productKeyword || siteConfig.productSearchKeyword || '헤어밴드';
    this.logger.log(`Step 5: Searching "${searchKeyword}" on Coupang...`);

    // Reference의 정확한 셀렉터: #wa-search-form input.headerSearchKeyword
    const coupangSearchSelector = '#wa-search-form input.headerSearchKeyword';

    try {
      // 검색 입력 필드가 보일 때까지 대기 (Reference 패턴)
      await coupangPage.waitForSelector(coupangSearchSelector, { timeout: 20000 });
      await this.randomDelay(3000, 6000);

      // 검색창으로 마우스 이동
      await this.moveMouseToElement(coupangPage, coupangSearchSelector);
      
      // 인간형 입력
      await this.humanType(coupangPage, coupangSearchSelector, searchKeyword, { clearFirst: true });
      
      await this.randomDelay(500, 1000);
      await coupangPage.keyboard.press('Enter');
      await coupangPage.waitForLoadState('load');
      await this.randomDelay(3000, 6000);

      // 검색 결과 페이지에서 복잡한 스크롤 패턴
      await this.humanScroll(coupangPage, 2 + Math.floor(Math.random() * 2));

      // 6. Reference 패턴: 검색 후 타겟 URL로 직접 이동 (검색 플로우로 세션 워밍업)
      this.logger.log('Step 6: Navigating directly to target product page...');
      await coupangPage.goto(targetUrl, {
        waitUntil: 'load',
        timeout: pageTimeout,
      });

      // Reference 패턴: networkidle 대기 + 추가 대기
      try {
        await coupangPage.waitForLoadState('networkidle', { timeout: 30000 });
      } catch {
        this.logger.warn('Network idle timeout, continuing...');
      }

      // Reference 패턴: SDP(상품 데이터) 스크립트 로드 대기
      try {
        await coupangPage.waitForFunction(
          "() => Array.from(document.scripts).some(s => s.innerHTML.includes('exports.sdp'))",
          { timeout: 15000 },
        );
        this.logger.log('SDP script loaded successfully');
      } catch {
        this.logger.warn('SDP script not found, page may be blocked or different layout');
      }

      await this.randomDelay(3000, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Coupang search failed: ${message}, trying fallback selectors...`);

      // Fallback 셀렉터들
      const fallbackSelectors = [
        'input[name="q"]',
        'input.search-input',
        'input[placeholder*="검색"]',
        '#headerSearchKeyword',
      ];

      let searchSuccess = false;
      for (const selector of fallbackSelectors) {
        try {
          const element = coupangPage.locator(selector).first();
          if (await element.isVisible({ timeout: 5000 })) {
            // 마우스 이동 및 인간형 입력
            await this.moveMouseToElement(coupangPage, selector);
            await this.humanType(coupangPage, selector, searchKeyword, { clearFirst: true });
            await this.randomDelay(500, 1000);
            await coupangPage.keyboard.press('Enter');
            await coupangPage.waitForLoadState('load');
            await this.randomDelay(3000, 6000);
            
            // 스크롤 패턴
            await this.humanScroll(coupangPage, 2);

            // Reference 패턴: 검색 후 타겟 URL로 직접 이동
            await coupangPage.goto(targetUrl, {
              waitUntil: 'load',
              timeout: pageTimeout,
            });
            searchSuccess = true;
            break;
          }
        } catch {
          // Try next selector
        }
      }

      if (!searchSuccess) {
        this.logger.warn('All search selectors failed, navigating directly to target URL');
        await coupangPage.goto(targetUrl, {
          waitUntil: 'load',
          timeout: pageTimeout,
        });
      }
    }

    // 원래 페이지 닫기 (네이버 페이지)
    await page.close();

    return coupangPage;
  }

  /**
   * Save cookies to file for future reuse
   */
  private async saveCookies(domain: string, cookies: Cookie[]): Promise<void> {
    try {
      const cookieFile = path.join(this.cookieDir, `${domain.replace(/\./g, '_')}.json`);
      const cookieData = {
        domain,
        cookies,
        savedAt: new Date().toISOString(),
        expiresAt: cookies.length > 0 
          ? new Date(Math.max(...cookies.map(c => c.expires || 0)) * 1000).toISOString()
          : null,
      };
      fs.writeFileSync(cookieFile, JSON.stringify(cookieData, null, 2));
      this.logger.log(`Saved ${cookies.length} cookies for ${domain} to ${cookieFile}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to save cookies for ${domain}: ${message}`);
    }
  }

  /**
   * Load saved cookies from file (if not expired)
   */
  private async loadCookies(domain: string): Promise<Cookie[]> {
    try {
      const cookieFile = path.join(this.cookieDir, `${domain.replace(/\./g, '_')}.json`);
      if (!fs.existsSync(cookieFile)) {
        return [];
      }

      const cookieData = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
      
      // Check if cookies are expired
      if (cookieData.expiresAt) {
        const expiresAt = new Date(cookieData.expiresAt);
        if (expiresAt < new Date()) {
          this.logger.log(`Saved cookies for ${domain} are expired, ignoring...`);
          return [];
        }
      }

      // Filter out expired cookies
      const validCookies = cookieData.cookies.filter((cookie: Cookie) => {
        if (!cookie.expires) return true; // Session cookies
        return cookie.expires * 1000 > Date.now();
      });

      if (validCookies.length > 0) {
        this.logger.log(`Loaded ${validCookies.length} valid cookies for ${domain}`);
        return validCookies;
      }

      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to load cookies for ${domain}: ${message}`);
      return [];
    }
  }

  /**
   * Extract domain from URL for site config lookup
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove 'www.' prefix and get base domain
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * Check if URL is a product detail page (PDP)
   */
  private isProductDetailPage(url: string): boolean {
    try {
      const urlObj = new URL(url);
      // Coupang PDP pattern: /vp/products/
      return urlObj.pathname.includes('/vp/products/') || urlObj.pathname.includes('/products/');
    } catch {
      return false;
    }
  }

  /**
   * Get site config for a given URL
   */
  private getSiteConfig(url: string, options?: FetchOptions): SiteConfig | undefined {
    // If explicit siteConfig is provided, use it
    if (options?.siteConfig) {
      return options.siteConfig;
    }

    // Otherwise, try to find a matching config
    const domain = this.extractDomain(url);
    
    // Check for exact match or partial match (e.g., 'coupang.com' matches 'www.coupang.com')
    for (const [configDomain, config] of Object.entries(SITE_CONFIGS)) {
      if (domain.includes(configDomain) || configDomain.includes(domain)) {
        return config;
      }
    }

    return undefined;
  }

  /**
   * 쿠키 워밍업 (간소화)
   */
  private async performCookieWarmup(
    context: BrowserContext,
    siteConfig: SiteConfig,
  ): Promise<void> {
    if (!siteConfig.warmupUrl) {
      return;
    }

    const domain = this.extractDomain(siteConfig.warmupUrl);
    
    // Try to load saved cookies first
    const savedCookies = await this.loadCookies(domain);
    if (savedCookies.length > 0) {
      try {
        await context.addCookies(savedCookies);
        this.logger.log(`Loaded ${savedCookies.length} saved cookies for ${domain}, skipping warmup`);
        this.warmedUpDomains.add(domain);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to load saved cookies, performing warmup: ${message}`);
      }
    }
    
    // Skip if already warmed up in this session
    if (this.warmedUpDomains.has(domain)) {
      this.logger.log(`Cookie warmup already done for: ${domain}`);
      return;
    }

    this.logger.log(`Performing cookie warmup for: ${domain}`);
    const page = await context.newPage();

    try {
      // Visit warmup URL (usually homepage) - wait for network idle to ensure JS execution
      await page.goto(siteConfig.warmupUrl, {
        waitUntil: 'networkidle',
        timeout: this.timeout,
      });

      // JavaScript 실행 및 쿠키 설정 대기
      await this.randomDelay(5000, 10000);

      // Log collected cookies for debugging
      const cookies = await page.context().cookies();
      const cookieNames = cookies.map((c) => c.name).join(', ');
      this.logger.log(
        `Cookie warmup completed for: ${domain} (${cookies.length} cookies: ${cookieNames.substring(0, 100)}...)`,
      );

      // Mark domain as warmed up
      this.warmedUpDomains.add(domain);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cookie warmup failed for ${domain}: ${message}`);
      // Don't throw - warmup failure shouldn't block the main request
    } finally {
      await page.close();
    }
  }



  /**
   * Get page content - tries HTTP fetch first, falls back to Playwright if needed
   */
  async getPageContent(url: string, options?: FetchOptions): Promise<string> {
    const result = await this.getPageContentWithInfo(url, options);
    return result.html;
  }

  /**
   * 페이지 콘텐츠 가져오기 (간소화)
   */
  async getPageContentWithInfo(
    url: string,
    options?: FetchOptions,
  ): Promise<FetchResult> {
    const timeout = options?.timeout ?? this.timeout;
    const siteConfig = this.getSiteConfig(url, options);
    const useSearchFlow = siteConfig?.useSearchFlow ?? false;

    // 프록시 설정: options에 명시적으로 지정된 경우 우선, 없으면 환경변수 기반 자동 설정
    let proxy = options?.proxy;
    if (!proxy) {
      const proxyConfig = this.configService.get<{ enabled: boolean; server: string; username: string; password: string } | undefined>('proxy');
      if (proxyConfig?.enabled) {
        proxy = {
          server: proxyConfig.server,
          username: proxyConfig.username,
          password: proxyConfig.password,
        };
        this.logger.log(`Using Bright Data proxy: ${proxyConfig.server}`);
      }
    }

    try {
      const context = await this.ensureBrowser(
        options?.headful ?? false,
        proxy,
      );

      // 쿠키 워밍업 (네이버 경유 플로우를 사용하는 경우는 스킵 - 플로우 자체가 워밍업 역할)
      if (siteConfig && !options?.skipWarmup && !useSearchFlow) {
        await this.performCookieWarmup(context, siteConfig);
      }

      const page = await context.newPage();
      let activePage: Page = page;

      try {
        // 네이버 경유 쿠팡 플로우 또는 직접 이동
        if (useSearchFlow && siteConfig?.warmupUrl) {
          const productKeyword = options?.productSearchKeyword || siteConfig?.productSearchKeyword;
          // navigateViaNaverToCoupang은 새 페이지를 반환하고 원래 페이지를 닫음
          activePage = await this.navigateViaNaverToCoupang(page, url, siteConfig, productKeyword, timeout);
        } else {
          await page.goto(url, {
            waitUntil: 'networkidle',
            timeout,
            referer: siteConfig?.referer,
          });
        }

        // 페이지 로드 대기
        await this.randomDelay(3000, 5000);

        // 쿠키 저장
        const domain = this.extractDomain(url);
        const cookies = await context.cookies();
        if (cookies.length > 0) {
          await this.saveCookies(domain, cookies);
        }

        const html = await activePage.content();
        const blocked = this.isBlockedContent(html);

        return {
          html,
          usedPlaywright: true,
          contentLength: html.length,
          blocked,
        };
      } finally {
        // activePage가 page와 다른 경우 (네이버 플로우), activePage만 닫으면 됨
        // page는 이미 navigateViaNaverToCoupang에서 닫힘
        if (activePage !== page) {
          await activePage.close();
        } else {
          await page.close();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CrawlException(`Failed to get page content: ${message}`, url);
    }
  }



  /**
   * Check if HTML response is valid (not blocked, not empty, has actual content)
   */
  private isValidHtmlResponse(html: string): boolean {
    // Check minimum length
    if (html.length < MIN_VALID_HTML_LENGTH) {
      return false;
    }

    // Check for essential e-commerce content markers
    const hasProductContent =
      html.includes('product') ||
      html.includes('price') ||
      html.includes('상품') ||
      html.includes('가격') ||
      html.includes('item') ||
      html.includes('prod-') ||
      html.includes('ProductName');

    return hasProductContent;
  }

  /**
   * Check if HTML content indicates blocked access
   */
  private isBlockedContent(html: string): boolean {
    const lowerHtml = html.toLowerCase();

    for (const indicator of BLOCKED_INDICATORS) {
      const lowerIndicator = indicator.toLowerCase();
      // Check in title
      if (lowerHtml.includes(`<title>${lowerIndicator}`)) {
        return true;
      }
      // Check in h1
      if (lowerHtml.includes(`<h1>${lowerIndicator}`)) {
        return true;
      }
      // Check in body with high frequency (likely main content)
      const count = (lowerHtml.match(new RegExp(lowerIndicator, 'g')) || [])
        .length;
      if (count > 3) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if page title indicates blocked access
   */
  private isBlockedResponse(title: string): boolean {
    const lowerTitle = title.toLowerCase();
    return BLOCKED_INDICATORS.some((indicator) =>
      lowerTitle.includes(indicator.toLowerCase()),
    );
  }

  /**
   * 쿠팡 전용 새 브라우저 인스턴스 생성 (Stealth Chromium)
   *
   * 테스트 결과: Chromium + Stealth 설정이 Akamai 우회에 성공함
   * - navigator.webdriver: undefined
   * - window.chrome.runtime: true (진짜 Chrome처럼)
   * - plugins, languages 마스킹
   */
  private async createFreshBrowserForCoupang(
    headless: boolean = false,
    proxy?: ProxyConfig,
  ): Promise<{ browser: Browser; context: BrowserContext }> {
    this.logger.log(`Creating STEALTH Chromium browser for Coupang (headless: ${headless})...`);

    const chromiumOptions: any = {
      headless,
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
    };

    if (proxy) {
      const proxyServer = proxy.server.startsWith('http')
        ? proxy.server
        : `http://${proxy.server}`;

      chromiumOptions.proxy = {
        server: proxyServer,
        username: proxy.username,
        password: proxy.password,
      };
      this.logger.log(`Proxy configured: ${proxyServer} (user: ${proxy.username?.substring(0, 30)}...)`);
    }

    const browser = await chromium.launch(chromiumOptions);
    const viewport = this.getRandomViewport();

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      geolocation: { latitude: 37.5665, longitude: 126.978 },
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      ignoreHTTPSErrors: !!proxy,
    });

    // Stealth 스크립트 주입 (테스트에서 검증됨)
    await context.addInitScript(() => {
      // 1. navigator.webdriver 마스킹 (undefined로 설정)
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 2. chrome.runtime 추가 (진짜 Chrome처럼)
      // @ts-ignore
      if (!window.chrome) window.chrome = {};
      // @ts-ignore
      if (!window.chrome.runtime) window.chrome.runtime = {};

      // 3. 플러그인 배열 (빈 배열 회피)
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
          if (param === 37445) return 'Intel Inc.';
          if (param === 37446) return 'Intel Iris OpenGL Engine';
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
    });

    return { browser, context };
  }

  /**
   * 쿠팡 검색 결과 페이지 가져오기 (리스트 페이지)
   * Reference: NextCoupangScraperService.kt의 네이버 → 쿠팡 플로우
   *
   * 중요: 프록시 미사용, 동일 context 유지 (Reference 패턴)
   */
  async getCoupangSearchResults(
    keyword: string,
    options?: FetchOptions,
  ): Promise<CoupangSearchResult> {
    const timeout = options?.timeout ?? this.timeout;

    // Reference 패턴: 프록시 없이 새 브라우저 인스턴스 생성
    // 프록시는 요청량이 많을 때만 옵션으로 사용
    const useProxy = options?.proxy !== undefined;
    const { browser, context } = await this.createFreshBrowserForCoupang(
      options?.headful === false,  // headful이 명시적으로 false가 아니면 headful 모드
      useProxy ? options?.proxy : undefined,  // 명시적으로 전달된 경우만 사용
    );

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);

      try {
        // 1. 네이버 접속 (load 후 추가 대기로 networkidle 효과)
        this.logger.log('Coupang Search Step 1: Visiting Naver...');
        await page.goto('https://www.naver.com', { waitUntil: 'load', timeout });
        await this.randomDelay(2000, 3000);  // Reference: Thread.sleep(2_000)

        // 2. 네이버에서 "쿠팡" 검색
        this.logger.log('Coupang Search Step 2: Searching "쿠팡" on Naver...');
        await page.locator('input[name="query"]').fill('쿠팡');
        await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded');
        await this.randomDelay(2000, 3000);

        // 3. 쿠팡 링크 추출
        this.logger.log('Coupang Search Step 3: Extracting Coupang URL...');
        let coupangUrl = 'https://www.coupang.com';
        const coupangLinks = page.locator('a:has-text("쿠팡")');
        const count = await coupangLinks.count();
        for (let i = 0; i < count; i++) {
          const href = await coupangLinks.nth(i).getAttribute('href');
          if (href && (href.startsWith('http') || href.includes('coupang.com'))) {
            coupangUrl = href;
            this.logger.log(`Found Coupang URL: ${coupangUrl}`);
            break;
          }
        }

        // 4. 새 탭에서 쿠팡 열기 (Reference 패턴)
        this.logger.log('Coupang Search Step 4: Opening Coupang in new tab...');
        const coupangPage = await context.newPage();
        coupangPage.setDefaultTimeout(timeout);

        await coupangPage.goto(coupangUrl, { waitUntil: 'load', timeout });

        // Akamai JS 챌린지 대기: 챌린지가 완료되면 페이지가 리로드됨
        // 챌린지 스크립트가 location.reload(true)를 호출함
        this.logger.log('Waiting for Akamai JS challenge and page reload...');

        // 1차 대기: networkidle로 JS 실행 완료 대기
        try {
          await coupangPage.waitForLoadState('networkidle', { timeout: 30000 });
        } catch {
          this.logger.warn('First networkidle timeout');
        }

        // 2차 대기: 페이지 리로드 감지 (JS 챌린지 완료 시 발생)
        try {
          // 페이지가 리로드되면 새로운 navigation이 발생
          await coupangPage.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle' });
          this.logger.log('Page reload detected, challenge may have passed');
        } catch {
          this.logger.warn('No navigation detected, checking page content...');
        }

        // 3차 대기: 검색 입력 필드가 나타나는지 확인 (챌린지 통과 시)
        const searchInput = coupangPage.locator('#wa-search-form input.headerSearchKeyword');
        try {
          await searchInput.waitFor({ state: 'visible', timeout: 20000 });
          this.logger.log('Search input visible - Akamai challenge passed!');
        } catch {
          this.logger.warn('Search input not visible - still blocked');
          // 현재 페이지 내용 로깅
          const currentHtml = await coupangPage.content();
          this.logger.log(`Current page length: ${currentHtml.length}`);
          if (currentHtml.length < 3000) {
            this.logger.log(`Page content: ${currentHtml.substring(0, 1000)}`);
          }
        }

        await this.randomDelay(5000, 7000);  // Reference: Thread.sleep(5_000)

        // 5. 쿠팡에서 키워드 검색 (Reference: 검색 입력 대기 후 5초 추가 대기)
        this.logger.log(`Coupang Search Step 5: Searching "${keyword}" on Coupang...`);
        const coupangSearchSelector = '#wa-search-form input.headerSearchKeyword';

        try {
          await coupangPage.waitForSelector(coupangSearchSelector, { timeout: 20000 });
          await this.randomDelay(5000, 7000);  // Reference: Thread.sleep(5_000) 후 검색

          await coupangPage.locator(coupangSearchSelector).fill(keyword);
          await coupangPage.keyboard.press('Enter');
          // Reference: waitForLoadState(LoadState.NETWORKIDLE) 후 검색
          try {
            await coupangPage.waitForLoadState('networkidle', { timeout: 30000 });
          } catch {
            this.logger.warn('Search networkidle timeout, continuing...');
          }
          await this.randomDelay(3000, 5000);

          // 스크롤로 상품 로딩 유도
          await coupangPage.evaluate(() => {
            window.scrollBy({ top: 500, behavior: 'smooth' });
          });
          await this.randomDelay(2000, 3000);
        } catch {
          this.logger.warn(`Search input failed, trying fallback selectors...`);
          const fallbackSelectors = ['input[name="q"]', 'input.search-input', '#headerSearchKeyword'];
          for (const selector of fallbackSelectors) {
            try {
              const element = coupangPage.locator(selector).first();
              if (await element.isVisible({ timeout: 5000 })) {
                await element.fill(keyword);
                await coupangPage.keyboard.press('Enter');
                await coupangPage.waitForLoadState('domcontentloaded');
                break;
              }
            } catch {
              // Try next
            }
          }
        }

        // 6. 검색 결과 HTML 가져오기
        const html = await coupangPage.content();
        const blocked = this.isBlockedContent(html);

        // JavaScript 챌린지 페이지 감지
        const isJsChallenge = html.includes('XMLHttpRequest.prototype.send') ||
                              html.includes('location.reload') ||
                              (html.length < 2000 && html.includes('<script'));

        // 7. 상품 링크 추출
        const productLinks: string[] = [];
        if (!blocked && !isJsChallenge) {
          const productElements = coupangPage.locator('a[href*="/vp/products/"]');
          const linkCount = await productElements.count();
          for (let i = 0; i < Math.min(linkCount, 20); i++) {
            const href = await productElements.nth(i).getAttribute('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.coupang.com${href}`;
              if (!productLinks.includes(fullUrl)) {
                productLinks.push(fullUrl);
              }
            }
          }
          this.logger.log(`Found ${productLinks.length} product links`);
        }

        // 쿠키 저장
        const cookies = await context.cookies();
        if (cookies.length > 0) {
          await this.saveCookies('coupang.com', cookies);
        }

        return { html, productLinks, blocked: blocked || isJsChallenge };
      } finally {
        // 모든 페이지와 브라우저 정리
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    } catch (error) {
      // 에러 시에도 브라우저 정리
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      throw new CrawlException(`Failed to get Coupang search results: ${message}`, `search:${keyword}`);
    }
  }

  /**
   * 쿠팡 상품 상세 페이지 가져오기 (exports.sdp 데이터 추출 포함)
   * Reference: NextCoupangScraperService.kt - 네이버 경유 후 상품 페이지 접근
   *
   * 중요: 프록시 미사용, 동일 context 유지 (Reference 패턴)
   */
  async getCoupangProductDetail(
    productUrl: string,
    options?: FetchOptions,
  ): Promise<CoupangProductDetail> {
    const timeout = options?.timeout ?? this.timeout;

    // Reference 패턴: 프록시 없이 새 브라우저 인스턴스 생성
    const useProxy = options?.proxy !== undefined;
    const { browser, context } = await this.createFreshBrowserForCoupang(
      options?.headful === false,
      useProxy ? options?.proxy : undefined,
    );

    try {
      // 저장된 쿠키 로드
      const savedCookies = await this.loadCookies('coupang.com');
      if (savedCookies.length > 0) {
        await context.addCookies(savedCookies);
        this.logger.log(`Loaded ${savedCookies.length} cookies for product detail`);
      }

      const page = await context.newPage();
      page.setDefaultTimeout(timeout);

      try {
        // Reference 패턴: 네이버 경유 후 상품 페이지 접근
        // 1. 네이버 접속
        this.logger.log('Product Detail Step 1: Visiting Naver...');
        await page.goto('https://www.naver.com', { waitUntil: 'load', timeout });
        await this.randomDelay(2000, 3000);

        // 2. 네이버에서 "쿠팡" 검색
        this.logger.log('Product Detail Step 2: Searching "쿠팡" on Naver...');
        await page.locator('input[name="query"]').fill('쿠팡');
        await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded');
        await this.randomDelay(2000, 3000);

        // 3. 쿠팡 링크 추출
        let coupangUrl = 'https://www.coupang.com';
        const coupangLinks = page.locator('a:has-text("쿠팡")');
        const count = await coupangLinks.count();
        for (let i = 0; i < count; i++) {
          const href = await coupangLinks.nth(i).getAttribute('href');
          if (href && (href.startsWith('http') || href.includes('coupang.com'))) {
            coupangUrl = href;
            break;
          }
        }

        // 4. 새 탭에서 쿠팡 열기
        this.logger.log('Product Detail Step 3: Opening Coupang in new tab...');
        const coupangPage = await context.newPage();
        coupangPage.setDefaultTimeout(timeout);
        await coupangPage.goto(coupangUrl, { waitUntil: 'load', timeout });
        await this.randomDelay(5000, 7000);

        // 5. 쿠팡에서 검색 (세션 워밍업)
        this.logger.log('Product Detail Step 4: Warming up session with search...');
        const coupangSearchSelector = '#wa-search-form input.headerSearchKeyword';
        try {
          await coupangPage.waitForSelector(coupangSearchSelector, { timeout: 20000 });
          await this.randomDelay(5000, 7000);
          await coupangPage.locator(coupangSearchSelector).fill('갤럭시25 자급제');
          await coupangPage.keyboard.press('Enter');
          await coupangPage.waitForLoadState('domcontentloaded');
          await this.randomDelay(3000, 5000);
        } catch {
          this.logger.warn('Search warmup failed, continuing...');
        }

        // 6. 상품 상세 페이지로 이동 (Reference 패턴)
        this.logger.log(`Product Detail Step 5: Navigating to product page: ${productUrl}`);
        await coupangPage.goto(productUrl, { waitUntil: 'load', timeout });

        // exports.sdp 스크립트 로드 대기 (Reference 패턴)
        try {
          await coupangPage.waitForFunction(
            "() => Array.from(document.scripts).some(s => s.innerHTML.includes('exports.sdp'))",
            { timeout: 15000 },
          );
          this.logger.log('SDP script loaded successfully');
        } catch {
          this.logger.warn('SDP script not found, page may be blocked');
        }

        await this.randomDelay(3000, 5000);

        const html = await coupangPage.content();
        const blocked = this.isBlockedContent(html);

        // JavaScript 챌린지 페이지 감지
        const isJsChallenge = html.includes('XMLHttpRequest.prototype.send') ||
                              html.includes('location.reload') ||
                              (html.length < 2000 && html.includes('<script'));

        // exports.sdp 데이터 추출 (Reference 패턴)
        let sdpData: Record<string, unknown> | undefined;
        let sdpRawJson: string | undefined;

        if (!blocked && !isJsChallenge) {
          try {
            const scriptData = await coupangPage.evaluate(() => {
              const scripts = Array.from(document.querySelectorAll('script'));
              for (const script of scripts) {
                const content = script.innerHTML;
                if (content.includes('exports.sdp =')) {
                  const parts = content.split('exports.sdp =');
                  if (parts.length > 1) {
                    const afterSdp = parts[1];
                    const jsonPart = afterSdp.split('exports.sdpIssueTypes')[0]?.replace(';', '')?.trim();
                    return jsonPart || null;
                  }
                }
              }
              return null;
            });

            if (scriptData) {
              sdpRawJson = scriptData;
              try {
                sdpData = JSON.parse(scriptData);
                this.logger.log('SDP data extracted and parsed successfully');
              } catch (parseError) {
                this.logger.warn(`Failed to parse SDP JSON: ${parseError}`);
              }
            }
          } catch (error) {
            this.logger.warn(`Failed to extract SDP data: ${error}`);
          }
        }

        // 쿠키 저장
        const cookies = await context.cookies();
        if (cookies.length > 0) {
          await this.saveCookies('coupang.com', cookies);
        }

        return { html, sdpData, sdpRawJson, blocked: blocked || isJsChallenge };
      } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    } catch (error) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      throw new CrawlException(`Failed to get Coupang product detail: ${message}`, productUrl);
    }
  }

  /**
   * 쿠팡 Vendor Item API 호출 (Reference: NextCoupangScraperService.kt)
   *
   * Reference 패턴 핵심:
   * 1. 네이버 → 쿠팡 플로우로 세션 워밍업
   * 2. 쿠팡 검색 완료 후 **같은 브라우저**에서 browser.newPage()로 API 호출
   * 3. API 페이지에서 pre 태그 내 JSON 추출
   *
   * 중요: 프록시 미사용, 검색 플로우로 세션 워밍업 후 API 호출 (Reference 패턴)
   */
  async getCoupangVendorItem(
    productId: string,
    vendorItemId: string,
    options?: FetchOptions,
  ): Promise<CoupangVendorItemResult> {
    const timeout = options?.timeout ?? this.timeout;

    // Reference 패턴: 프록시 없이 새 브라우저 인스턴스 생성
    const useProxy = options?.proxy !== undefined;
    const { browser, context } = await this.createFreshBrowserForCoupang(
      options?.headful === false,
      useProxy ? options?.proxy : undefined,
    );

    try {
      // 저장된 쿠키 로드
      const savedCookies = await this.loadCookies('coupang.com');
      if (savedCookies.length > 0) {
        await context.addCookies(savedCookies);
      }

      const page = await context.newPage();
      page.setDefaultTimeout(timeout);

      try {
        // Reference 패턴: 네이버 경유 → 쿠팡 검색 → API 호출
        // 1. 네이버 접속
        this.logger.log('Vendor Item Step 1: Visiting Naver...');
        await page.goto('https://www.naver.com', { waitUntil: 'load', timeout });
        await this.randomDelay(2000, 3000);

        // 2. 네이버에서 "쿠팡" 검색
        this.logger.log('Vendor Item Step 2: Searching "쿠팡" on Naver...');
        await page.locator('input[name="query"]').fill('쿠팡');
        await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded');
        await this.randomDelay(2000, 3000);

        // 3. 쿠팡 링크 추출
        let coupangUrl = 'https://www.coupang.com';
        const coupangLinks = page.locator('a:has-text("쿠팡")');
        const count = await coupangLinks.count();
        for (let i = 0; i < count; i++) {
          const href = await coupangLinks.nth(i).getAttribute('href');
          if (href && (href.startsWith('http') || href.includes('coupang.com'))) {
            coupangUrl = href;
            break;
          }
        }

        // 4. 새 탭에서 쿠팡 열기 (Reference: context.newPage())
        this.logger.log('Vendor Item Step 3: Opening Coupang in new tab...');
        const coupangPage = await context.newPage();
        coupangPage.setDefaultTimeout(timeout);
        await coupangPage.goto(coupangUrl, { waitUntil: 'load', timeout });

        // Akamai JS 챌린지 대기: 챌린지가 완료되면 페이지가 리로드됨
        // networkidle 상태까지 대기하여 JS 실행 완료 확인
        this.logger.log('Waiting for Akamai JS challenge to complete...');
        try {
          await coupangPage.waitForLoadState('networkidle', { timeout: 30000 });
        } catch {
          this.logger.warn('networkidle timeout, trying to wait for navigation...');
        }

        // 추가 대기: JS 챌린지 후 리로드 대기
        await this.randomDelay(5000, 7000);

        // 5. 쿠팡에서 검색 (세션 워밍업) - Reference 패턴
        this.logger.log('Vendor Item Step 4: Warming up session with search...');
        const coupangSearchSelector = '#wa-search-form input.headerSearchKeyword';
        try {
          await coupangPage.waitForSelector(coupangSearchSelector, { timeout: 20000 });
          await this.randomDelay(5000, 7000);  // Reference: Thread.sleep(5_000)
          await coupangPage.locator(coupangSearchSelector).fill('갤럭시25 자급제');
          await coupangPage.keyboard.press('Enter');
          // Reference: waitForLoadState(LoadState.NETWORKIDLE)
          try {
            await coupangPage.waitForLoadState('networkidle', { timeout: 30000 });
          } catch {
            this.logger.warn('Search networkidle timeout, continuing...');
          }
          await this.randomDelay(3000, 5000);
          this.logger.log('Search warmup completed successfully');
        } catch (searchError) {
          this.logger.warn(`Search warmup failed: ${searchError}`);
        }

        // Reference 패턴 핵심: 검색 완료 후 검색 페이지를 닫지 않고 유지한 상태에서
        // **같은 context**에서 새 페이지를 열어 API 호출
        // Note: Playwright Node.js에서 browser.newPage()는 새 context를 생성하므로 쿠키 공유 안됨
        // 따라서 context.newPage()를 사용해야 세션이 유지됨

        // 6. Vendor Item API 호출 (Reference: NextCoupangScraperService.kt)
        const apiUrl = `https://www.coupang.com/next-api/products/vendor-items?productId=${productId}&vendorItemId=${vendorItemId}`;
        this.logger.log(`Vendor Item Step 5: Fetching API in same context session: ${apiUrl}`);

        // 같은 context에서 새 페이지 생성 (쿠키/세션 공유)
        const apiPage = await context.newPage();
        apiPage.setDefaultTimeout(timeout);

        // Reference: setViewportSize(600, 600)
        await apiPage.setViewportSize({ width: 600, height: 600 });

        await apiPage.goto(apiUrl, { waitUntil: 'load', timeout });
        await this.randomDelay(1000, 2000);

        // JSON 응답 추출 (브라우저가 pre 태그에 JSON을 표시함)
        let rawJson: string | undefined;
        let data: Record<string, unknown> | null = null;

        // 페이지 HTML 디버깅
        const pageHtml = await apiPage.content();
        this.logger.log(`[DEBUG] API page HTML length: ${pageHtml.length}`);
        if (pageHtml.length < 3000) {
          this.logger.log(`[DEBUG] API page HTML: ${pageHtml}`);
        }

        try {
          // Reference: productPage.locator("pre").textContent()
          rawJson = await apiPage.locator('pre').textContent() ?? undefined;
          this.logger.log(`[DEBUG] pre tag content length: ${rawJson?.length ?? 0}`);
          if (rawJson) {
            data = JSON.parse(rawJson);
            this.logger.log('Vendor item data fetched successfully');
          }
        } catch (preError) {
          this.logger.warn(`[DEBUG] pre tag extraction failed: ${preError}`);
          // pre 태그가 없으면 body 전체 텍스트 시도
          try {
            rawJson = await apiPage.locator('body').textContent() ?? undefined;
            this.logger.log(`[DEBUG] body text length: ${rawJson?.length ?? 0}`);
            if (rawJson) {
              data = JSON.parse(rawJson);
            }
          } catch (bodyError) {
            this.logger.warn(`[DEBUG] body extraction failed: ${bodyError}`);
          }
        }

        return { data, rawJson, pageHtml };
      } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    } catch (error) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      return { data: null, error: message };
    }
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        try {
          await Promise.race([
            this.context.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Context close timeout')), 5000),
            ),
          ]);
        } catch (error) {
          this.logger.warn(`Failed to close context: ${error}`);
        }
        this.context = null;
      }
    } catch (error) {
      this.logger.warn(`Error closing context: ${error}`);
    }

    try {
      if (this.browser) {
        try {
          await Promise.race([
            this.browser.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Browser close timeout')), 5000),
            ),
          ]);
        } catch (error) {
          this.logger.warn(`Failed to close browser: ${error}`);
        }
        this.browser = null;
        // Clear warmed up domains when browser is closed
        this.warmedUpDomains.clear();
        this.logger.log('Browser closed');
      }
    } catch (error) {
      this.logger.warn(`Error closing browser: ${error}`);
      this.browser = null;
      this.warmedUpDomains.clear();
    }
  }
}
