import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, BrowserContext } from 'playwright';
import { IBrowserClient } from '@/domain/interfaces';
import { CrawlException } from '@/common';
import { createLogger } from '@/common';

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
      this.logger.log('Launching browser...');
      this.browser = await chromium.launch({
        headless: this.headless,
      });
      this.context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });
    }
    return this.context!;
  }

  async getPageContent(url: string): Promise<string> {
    try {
      const context = await this.ensureBrowser();
      const page = await context.newPage();

      try {
        this.logger.log(`Navigating to: ${url}`);
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });

        await page.waitForTimeout(2000);

        const html = await page.content();
        this.logger.log(`Page loaded, HTML length: ${html.length}`);
        return html;
      } finally {
        await page.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CrawlException(`Failed to get page content: ${message}`, url);
    }
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
