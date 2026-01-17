import { CrawlException, createLogger } from '@/common';
import { FetchOptions, FetchResult, IBrowserClient } from '@/domain/interfaces';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Browser, BrowserContext } from 'playwright';
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
];

@Injectable()
export class PlaywrightClient implements IBrowserClient, OnModuleDestroy {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly logger = createLogger(PlaywrightClient.name);
  private readonly headless: boolean;
  private readonly timeout: number;

  constructor(private readonly configService: ConfigService) {
    this.headless = this.configService.get<boolean>('browser.headless', true);
    this.timeout = this.configService.get<number>('browser.timeout', 30000);
  }

  async onModuleDestroy() {
    await this.close();
  }

  private async ensureBrowser(): Promise<BrowserContext> {
    if (!this.browser) {
      this.logger.log('Launching browser with stealth mode...');
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });
      this.context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        extraHTTPHeaders: {
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Cache-Control': 'max-age=0',
          'Sec-Ch-Ua':
            '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
      });
    }
    return this.context!;
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
   */
  async getPageContentWithInfo(
    url: string,
    options?: FetchOptions,
  ): Promise<FetchResult> {
    const effectiveTimeout = options?.timeout ?? this.timeout;

    // If forcePlaywright is set, skip HTTP fetch
    if (options?.forcePlaywright) {
      this.logger.log(`Force Playwright mode for: ${url}`);
      return this.fetchWithPlaywright(url, effectiveTimeout);
    }

    // Try HTTP fetch first
    try {
      const httpResult = await this.fetchWithHttp(url, effectiveTimeout);

      // Check if HTTP response is valid
      if (this.isValidHtmlResponse(httpResult.html)) {
        this.logger.log(
          `HTTP fetch successful for: ${url} (${httpResult.contentLength} bytes)`,
        );
        return httpResult;
      }

      this.logger.log(
        `HTTP response invalid or too short (${httpResult.contentLength} bytes), falling back to Playwright`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log(`HTTP fetch failed (${message}), falling back to Playwright`);
    }

    // Fallback to Playwright
    return this.fetchWithPlaywright(url, effectiveTimeout);
  }

  /**
   * Simple HTTP fetch without browser
   */
  private async fetchWithHttp(
    url: string,
    timeout: number,
  ): Promise<FetchResult> {
    this.logger.log(`Attempting HTTP fetch for: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Cache-Control': 'max-age=0',
          'Sec-Ch-Ua':
            '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
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
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch using Playwright with full browser rendering
   */
  private async fetchWithPlaywright(
    url: string,
    timeout: number,
  ): Promise<FetchResult> {
    try {
      const context = await this.ensureBrowser();
      const page = await context.newPage();

      try {
        this.logger.log(`Playwright navigating to: ${url}`);

        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout,
        });

        // Random delay to appear more human-like
        await page.waitForTimeout(1000 + Math.random() * 2000);

        // Simulate human-like scrolling
        await page.evaluate(() => {
          window.scrollBy(0, 300);
        });
        await page.waitForTimeout(500 + Math.random() * 1000);

        // Wait for any lazy-loaded content
        await page.waitForTimeout(1000);

        const html = await page.content();
        this.logger.log(`Playwright loaded page, HTML length: ${html.length}`);

        // Check if we got blocked
        const title = await page.title();
        if (this.isBlockedResponse(title)) {
          this.logger.warn(`Page appears to be blocked: ${title}`);
        }

        return {
          html,
          usedPlaywright: true,
          contentLength: html.length,
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

    // Check for blocked indicators in content
    const lowerHtml = html.toLowerCase();
    for (const indicator of BLOCKED_INDICATORS) {
      if (lowerHtml.includes(indicator.toLowerCase())) {
        // Only consider it blocked if the indicator appears in title or specific elements
        if (
          lowerHtml.includes(`<title>${indicator}`) ||
          lowerHtml.includes(`<h1>${indicator}`) ||
          lowerHtml.includes(`<h1 class`) && lowerHtml.includes(indicator)
        ) {
          return false;
        }
      }
    }

    // Check for essential e-commerce content markers
    const hasProductContent =
      html.includes('product') ||
      html.includes('price') ||
      html.includes('상품') ||
      html.includes('가격') ||
      html.includes('item');

    return hasProductContent;
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
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.log('Browser closed');
    }
  }
}
