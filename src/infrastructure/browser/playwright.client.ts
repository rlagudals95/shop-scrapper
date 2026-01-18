import { CrawlException, createLogger } from '@/common';
import {
  FetchOptions,
  FetchResult,
  IBrowserClient,
  SiteConfig,
  SITE_CONFIGS,
  StealthLevel,
} from '@/domain/interfaces';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';

const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

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

/** User agents pool for randomization - Updated to Chrome 143 */
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
];

/** Viewport sizes for randomization */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

@Injectable()
export class PlaywrightClient implements IBrowserClient, OnModuleDestroy {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly logger = createLogger(PlaywrightClient.name);
  private readonly defaultHeadless: boolean;
  private readonly timeout: number;
  private currentStealthLevel: StealthLevel = StealthLevel.BASIC;
  /** Track which domains have been warmed up in this session */
  private warmedUpDomains: Set<string> = new Set();

  constructor(private readonly configService: ConfigService) {
    this.defaultHeadless = this.configService.get<boolean>(
      'browser.headless',
      true,
    );
    this.timeout = this.configService.get<number>('browser.timeout', 30000);
  }

  async onModuleDestroy() {
    await this.close();
  }

  /**
   * Get a random user agent from the pool
   */
  private getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * Get a random viewport size
   */
  private getRandomViewport(): { width: number; height: number } {
    return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  }

  /**
   * Ensure browser is running with specified stealth level
   */
  private async ensureBrowser(
    stealthLevel: StealthLevel = StealthLevel.BASIC,
    forceHeadful: boolean = false,
  ): Promise<BrowserContext> {
    // If stealth level changed or browser doesn't exist, recreate
    if (this.browser && this.currentStealthLevel !== stealthLevel) {
      await this.close();
    }

    if (!this.browser) {
      const headless = forceHeadful ? false : this.defaultHeadless;
      this.currentStealthLevel = stealthLevel;

      this.logger.log(
        `Launching browser (stealth: ${stealthLevel}, headless: ${headless})...`,
      );

      const args = [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ];

      // Additional args for full stealth
      if (stealthLevel === StealthLevel.FULL) {
        args.push(
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
        );
      }

      this.browser = await chromium.launch({
        headless,
        args,
      });

      const userAgent = this.getRandomUserAgent();
      const viewport = this.getRandomViewport();

      this.context = await this.browser.newContext({
        userAgent,
        viewport,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        geolocation: { latitude: 37.5665, longitude: 126.978 }, // Seoul
        permissions: ['geolocation'],
        extraHTTPHeaders: this.getHeaders(userAgent),
      });

      // Apply stealth scripts to context
      if (stealthLevel !== StealthLevel.NONE) {
        await this.applyStealthScripts(this.context, stealthLevel);
      }
    }

    return this.context!;
  }

  /**
   * Get HTTP headers based on user agent and referer
   */
  private getHeaders(userAgent: string, referer?: string): Record<string, string> {
    const chromeVersion = userAgent.match(/Chrome\/(\d+)/)?.[1] || '143';

    const headers: Record<string, string> = {
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Priority': 'u=0, i',
      'Sec-Ch-Ua': `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not A(Brand";v="24"`,
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': userAgent.includes('Windows')
        ? '"Windows"'
        : userAgent.includes('Mac')
          ? '"macOS"'
          : '"Linux"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    // Add Referer header if provided
    if (referer) {
      headers['Referer'] = referer;
    }

    return headers;
  }

  /**
   * Apply stealth scripts to browser context
   */
  private async applyStealthScripts(
    context: BrowserContext,
    level: StealthLevel,
  ): Promise<void> {
    // Basic stealth: Remove webdriver flag
    await context.addInitScript(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Override permissions query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              state: Notification.permission,
            } as PermissionStatus)
          : originalQuery(parameters);
    });

    // Full stealth: Additional anti-detection measures
    if (level === StealthLevel.FULL) {
      await context.addInitScript(() => {
        // Mock chrome runtime
        (window as any).chrome = {
          runtime: {},
          loadTimes: () => ({}),
          csi: () => ({}),
          app: {},
        };

        // Mock plugins array
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const plugins = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
              {
                name: 'Chrome PDF Viewer',
                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
              },
              {
                name: 'Native Client',
                filename: 'internal-nacl-plugin',
              },
            ];
            return Object.assign(plugins, { length: plugins.length });
          },
        });

        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        });

        // Mock hardware concurrency
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8,
        });

        // Mock device memory
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8,
        });

        // Mock connection
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false,
          }),
        });

        // Prevent canvas fingerprinting detection
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type?: string) {
          if (type === 'image/png') {
            return originalToDataURL.apply(this, [type]);
          }
          return originalToDataURL.apply(this, [type]);
        };

        // Mock WebGL vendor and renderer
        const getParameterProxyHandler = {
          apply: function (
            target: (pname: number) => any,
            thisArg: WebGLRenderingContext,
            args: [number],
          ) {
            const param = args[0];
            // UNMASKED_VENDOR_WEBGL
            if (param === 37445) {
              return 'Intel Inc.';
            }
            // UNMASKED_RENDERER_WEBGL
            if (param === 37446) {
              return 'Intel Iris OpenGL Engine';
            }
            return Reflect.apply(target, thisArg, args);
          },
        };

        const originalGetParameter =
          WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = new Proxy(
          originalGetParameter,
          getParameterProxyHandler,
        );
      });
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
   * Perform cookie warmup by visiting the site's main page first
   * Waits for JavaScript execution and Bot Manager cookies
   */
  private async performCookieWarmup(
    context: BrowserContext,
    siteConfig: SiteConfig,
    stealthLevel: StealthLevel,
  ): Promise<void> {
    if (!siteConfig.warmupUrl) {
      return;
    }

    const domain = this.extractDomain(siteConfig.warmupUrl);
    
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

      // Wait for JavaScript to execute and set cookies (especially Bot Manager cookies)
      // Akamai Bot Manager cookies (_abck, ak_bmsc) are set by JavaScript
      const minDelay = siteConfig.minDelay ?? 5000;
      const maxDelay = siteConfig.maxDelay ?? 10000;
      const initialDelay = minDelay + Math.random() * (maxDelay - minDelay);
      await page.waitForTimeout(initialDelay);

      // Check for Bot Manager cookies (Akamai-specific)
      try {
        await page.waitForFunction(
          () => {
            const cookies = document.cookie;
            // Check for common Bot Manager cookies
            return (
              cookies.includes('_abck') ||
              cookies.includes('ak_bmsc') ||
              cookies.includes('bm_') ||
              cookies.length > 100 // If cookies are set, likely Bot Manager is active
            );
          },
          { timeout: 10000 },
        ).catch(() => {
          // If cookies don't appear, continue anyway
          this.logger.log(`Bot Manager cookies not detected, continuing...`);
        });
      } catch {
        // Continue even if cookie check times out
      }

      // Additional wait for any remaining JavaScript execution
      await page.waitForTimeout(2000 + Math.random() * 3000);

      // Simulate some human behavior on warmup page
      if (siteConfig.enhancedHumanBehavior) {
        await this.simulateEnhancedHumanBehavior(page);
      } else {
        await this.simulateHumanBehavior(page, stealthLevel);
      }

      // Final wait to ensure all cookies are properly set
      await page.waitForTimeout(1000 + Math.random() * 2000);

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
   * Enhanced human behavior simulation for strict anti-bot sites
   */
  private async simulateEnhancedHumanBehavior(page: Page): Promise<void> {
    const viewport = page.viewportSize();

    // Initial pause like a real user would
    await page.waitForTimeout(1500 + Math.random() * 2000);

    // Multiple scroll actions with varying speeds
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      // Scroll down
      const scrollAmount = 150 + Math.random() * 350;
      await page.evaluate((amount) => {
        window.scrollBy({
          top: amount,
          behavior: 'smooth',
        });
      }, scrollAmount);
      
      await page.waitForTimeout(800 + Math.random() * 1500);

      // Occasional mouse movement
      if (viewport && Math.random() > 0.3) {
        const x = 50 + Math.random() * (viewport.width - 100);
        const y = 50 + Math.random() * (viewport.height - 100);
        await page.mouse.move(x, y, { steps: 15 + Math.floor(Math.random() * 10) });
        await page.waitForTimeout(200 + Math.random() * 500);
      }
    }

    // Scroll back up partially (like reading)
    await page.evaluate(() => {
      window.scrollBy({
        top: -(100 + Math.random() * 200),
        behavior: 'smooth',
      });
    });
    await page.waitForTimeout(500 + Math.random() * 1000);

    // Final random mouse movements
    if (viewport) {
      for (let i = 0; i < 2; i++) {
        const x = Math.random() * viewport.width;
        const y = Math.random() * viewport.height;
        await page.mouse.move(x, y, { steps: 8 });
        await page.waitForTimeout(100 + Math.random() * 400);
      }
    }

    // Hover over a random element (if any clickable elements exist)
    try {
      const links = await page.locator('a').all();
      if (links.length > 0) {
        const randomLink = links[Math.floor(Math.random() * Math.min(links.length, 10))];
        await randomLink.hover({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300 + Math.random() * 700);
      }
    } catch {
      // Ignore hover errors
    }
  }

  /**
   * Simulate human-like behavior on page
   */
  private async simulateHumanBehavior(
    page: Page,
    level: StealthLevel,
  ): Promise<void> {
    // Basic delay
    await page.waitForTimeout(1000 + Math.random() * 2000);

    if (level === StealthLevel.NONE) return;

    // Mouse movement
    const viewport = page.viewportSize();
    if (viewport) {
      const x = 100 + Math.random() * (viewport.width - 200);
      const y = 100 + Math.random() * (viewport.height - 200);
      await page.mouse.move(x, y, { steps: 10 });
    }

    // Scroll down
    await page.evaluate(() => {
      window.scrollBy({
        top: 200 + Math.random() * 300,
        behavior: 'smooth',
      });
    });
    await page.waitForTimeout(500 + Math.random() * 1000);

    // Full stealth: Additional behavior
    if (level === StealthLevel.FULL) {
      // Random mouse movements
      for (let i = 0; i < 3; i++) {
        if (viewport) {
          const x = Math.random() * viewport.width;
          const y = Math.random() * viewport.height;
          await page.mouse.move(x, y, { steps: 5 });
          await page.waitForTimeout(100 + Math.random() * 300);
        }
      }

      // Scroll more
      await page.evaluate(() => {
        window.scrollBy({
          top: 100 + Math.random() * 200,
          behavior: 'smooth',
        });
      });
      await page.waitForTimeout(300 + Math.random() * 500);

      // Scroll back up a bit
      await page.evaluate(() => {
        window.scrollBy({
          top: -(50 + Math.random() * 100),
          behavior: 'smooth',
        });
      });
      await page.waitForTimeout(500 + Math.random() * 1000);
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
   * Get page content with detailed information about how it was fetched
   * Implements multi-level fallback strategy:
   * 1. HTTP fetch (fastest)
   * 2. Basic Playwright (with stealth plugin) - only if autoFallback is true
   * 3. Full Stealth Playwright (maximum anti-detection)
   * 4. Headful + Full Stealth (last resort)
   */
  async getPageContentWithInfo(
    url: string,
    options?: FetchOptions,
  ): Promise<FetchResult> {
    const effectiveTimeout = options?.timeout ?? this.timeout;
    const requestedStealthLevel = options?.stealthLevel ?? StealthLevel.BASIC;
    const autoFallback = options?.autoFallback ?? false; // 기본값: false (자동 fallback 비활성화)
    const skipWarmup = options?.skipWarmup ?? false;

    // Get site-specific configuration
    const siteConfig = this.getSiteConfig(url, options);
    if (siteConfig) {
      this.logger.log(`Using site config for: ${this.extractDomain(url)}`);
    }

    // If forcePlaywright is set, skip HTTP fetch
    if (options?.forcePlaywright) {
      this.logger.log(
        `Force Playwright mode (stealth: ${requestedStealthLevel}) for: ${url}`,
      );
      return this.fetchWithPlaywright(
        url,
        effectiveTimeout,
        requestedStealthLevel,
        options?.headful,
        siteConfig,
        skipWarmup,
      );
    }

    // Step 1: Try HTTP fetch first (with referer if configured)
    try {
      const httpResult = await this.fetchWithHttp(url, effectiveTimeout, siteConfig?.referer);

      if (
        this.isValidHtmlResponse(httpResult.html) &&
        !this.isBlockedContent(httpResult.html)
      ) {
        this.logger.log(
          `HTTP fetch successful for: ${url} (${httpResult.contentLength} bytes)`,
        );
        return { ...httpResult, stealthLevel: StealthLevel.NONE, blocked: false };
      }

      // HTTP fetch 실패 시 autoFallback이 false면 예외 던지기
      if (!autoFallback) {
        const errorMessage = `HTTP fetch failed or blocked for: ${url}. Use forcePlaywright or set autoFallback=true to enable browser fallback.`;
        this.logger.warn(errorMessage);
        throw new Error(errorMessage);
      }

      this.logger.log(
        `HTTP response blocked or invalid (${httpResult.contentLength} bytes), trying Playwright...`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      // autoFallback이 false면 예외를 그대로 전파
      if (!autoFallback) {
        this.logger.warn(`HTTP fetch failed (${message}). Auto-fallback disabled. Use forcePlaywright or set autoFallback=true.`);
        throw error;
      }
      
      this.logger.log(`HTTP fetch failed (${message}), trying Playwright...`);
    }

    // Step 2: Try Basic Playwright with site config
    try {
      const basicResult = await this.fetchWithPlaywright(
        url,
        effectiveTimeout,
        StealthLevel.BASIC,
        false,
        siteConfig,
        skipWarmup,
      );

      if (
        this.isValidHtmlResponse(basicResult.html) &&
        !this.isBlockedContent(basicResult.html)
      ) {
        this.logger.log(`Basic Playwright successful for: ${url}`);
        return { ...basicResult, blocked: false };
      }

      this.logger.log(
        `Basic Playwright blocked, upgrading to Full Stealth...`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Basic Playwright failed (${message}), trying Full Stealth...`);
    }

    // Step 3: Try Full Stealth Playwright
    try {
      // Close existing browser to apply new stealth level
      await this.close();

      const fullStealthResult = await this.fetchWithPlaywright(
        url,
        effectiveTimeout,
        StealthLevel.FULL,
        false,
        siteConfig,
        true, // Skip warmup since we already did it
      );

      if (
        this.isValidHtmlResponse(fullStealthResult.html) &&
        !this.isBlockedContent(fullStealthResult.html)
      ) {
        this.logger.log(`Full Stealth Playwright successful for: ${url}`);
        return { ...fullStealthResult, blocked: false };
      }

      this.logger.log(`Full Stealth blocked, trying Headful mode...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Full Stealth failed (${message}), trying Headful...`);
    }

    // Step 4: Last resort - Headful + Full Stealth
    await this.close();

    const headfulResult = await this.fetchWithPlaywright(
      url,
      effectiveTimeout,
      StealthLevel.FULL,
      true, // Force headful
      siteConfig,
      true, // Skip warmup
    );

    const blocked = this.isBlockedContent(headfulResult.html);
    if (blocked) {
      this.logger.warn(`All stealth methods failed - page appears blocked`);
    }

    return { ...headfulResult, blocked };
  }

  /**
   * Simple HTTP fetch without browser
   */
  private async fetchWithHttp(
    url: string,
    timeout: number,
    referer?: string,
  ): Promise<FetchResult> {
    this.logger.log(`Attempting HTTP fetch for: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const userAgent = this.getRandomUserAgent();

    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      ...this.getHeaders(userAgent, referer),
    };

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      return {
        html,
        usedPlaywright: false,
        contentLength: html.length,
        stealthLevel: StealthLevel.NONE,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Perform search flow: warmup → intermediate (search) → target page
   */
  private async performSearchFlow(
    context: BrowserContext,
    targetUrl: string,
    siteConfig: SiteConfig,
    stealthLevel: StealthLevel,
  ): Promise<void> {
    if (!siteConfig.intermediateUrl) {
      return;
    }

    this.logger.log(`Performing search flow: warmup → search → target`);
    const page = await context.newPage();

    try {
      // Step 1: Visit warmup URL (homepage) if specified
      if (siteConfig.warmupUrl) {
        this.logger.log(`Step 1: Visiting warmup URL: ${siteConfig.warmupUrl}`);
        await page.goto(siteConfig.warmupUrl, {
          waitUntil: 'networkidle',
          timeout: this.timeout,
        });

        const minDelay = siteConfig.minDelay ?? 5000;
        const maxDelay = siteConfig.maxDelay ?? 10000;
        await page.waitForTimeout(minDelay + Math.random() * (maxDelay - minDelay));
      }

      // Step 2: Visit intermediate URL (search results page)
      this.logger.log(`Step 2: Visiting intermediate URL (search): ${siteConfig.intermediateUrl}`);
      await page.goto(siteConfig.intermediateUrl, {
        waitUntil: 'networkidle',
        timeout: this.timeout,
      });

      // Wait for search page to load and set cookies
      await page.waitForTimeout(3000 + Math.random() * 3000);

      // Simulate human behavior on search page
      if (siteConfig.enhancedHumanBehavior) {
        await this.simulateEnhancedHumanBehavior(page);
      } else {
        await this.simulateHumanBehavior(page, stealthLevel);
      }

      // Additional wait for cookies and session setup
      await page.waitForTimeout(2000 + Math.random() * 2000);

      this.logger.log(`Search flow completed, ready to navigate to target page`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Search flow failed: ${message}`);
      // Don't throw - continue to target page anyway
    } finally {
      await page.close();
    }
  }

  /**
   * Fetch using Playwright with specified stealth level
   */
  private async fetchWithPlaywright(
    url: string,
    timeout: number,
    stealthLevel: StealthLevel = StealthLevel.BASIC,
    forceHeadful: boolean = false,
    siteConfig?: SiteConfig,
    skipWarmup: boolean = false,
  ): Promise<FetchResult> {
    try {
      const context = await this.ensureBrowser(stealthLevel, forceHeadful);

      // Check if we should use search flow (for product detail pages)
      const useSearchFlow =
        siteConfig?.useSearchFlow &&
        siteConfig?.intermediateUrl &&
        this.isProductDetailPage(url);

      this.logger.log(
        `Flow decision: useSearchFlow=${useSearchFlow}, isPDP=${this.isProductDetailPage(url)}, hasIntermediate=${!!siteConfig?.intermediateUrl}, useSearchFlowConfig=${siteConfig?.useSearchFlow}`,
      );

      if (useSearchFlow && !skipWarmup) {
        // Use search flow: warmup → search → target
        this.logger.log(`Using search flow for product detail page: ${url}`);
        await this.performSearchFlow(context, url, siteConfig, stealthLevel);
      } else if (siteConfig && !skipWarmup && siteConfig.warmupUrl) {
        // Use simple warmup: just warmup → target
        this.logger.log(`Using simple warmup for: ${url}`);
        await this.performCookieWarmup(context, siteConfig, stealthLevel);
      } else {
        this.logger.log(`No warmup needed for: ${url}`);
      }

      const page = await context.newPage();

      // Set referer header - use intermediate URL if search flow was used
      const refererUrl = useSearchFlow
        ? siteConfig?.intermediateUrl
        : siteConfig?.referer;
      if (refererUrl) {
        await page.setExtraHTTPHeaders({
          Referer: refererUrl,
        });
      }

      try {
        this.logger.log(
          `Playwright (stealth: ${stealthLevel}, headful: ${forceHeadful}) navigating to: ${url}`,
        );

        // Navigate with wait for network idle
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout,
          referer: refererUrl,
        });

        // Apply site-specific extra delay
        if (siteConfig?.extraDelay) {
          await page.waitForTimeout(siteConfig.extraDelay);
        }

        // Simulate human behavior (enhanced for strict sites)
        if (siteConfig?.enhancedHumanBehavior) {
          await this.simulateEnhancedHumanBehavior(page);
        } else {
          await this.simulateHumanBehavior(page, stealthLevel);
        }

        // Wait for any lazy-loaded content
        await page.waitForTimeout(1000);

        const html = await page.content();
        this.logger.log(`Playwright loaded page, HTML length: ${html.length}`);

        // Check if we got blocked
        const title = await page.title();
        const blocked = this.isBlockedResponse(title);
        if (blocked) {
          this.logger.warn(`Page appears to be blocked: ${title}`);
        }

        return {
          html,
          usedPlaywright: true,
          contentLength: html.length,
          stealthLevel,
          blocked,
        };
      } finally {
        await page.close();
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
        this.currentStealthLevel = StealthLevel.NONE;
        // Clear warmed up domains when browser is closed
        this.warmedUpDomains.clear();
        this.logger.log('Browser closed');
      }
    } catch (error) {
      this.logger.warn(`Error closing browser: ${error}`);
      this.browser = null;
      this.currentStealthLevel = StealthLevel.NONE;
      this.warmedUpDomains.clear();
    }
  }
}
