import * as fs from 'fs';
import * as path from 'path';
import { FetchOptions, FetchResult, IBrowserClient, StealthLevel } from '../../src/domain/interfaces';

export class MockBrowserClient implements IBrowserClient {
  private urlToHtml: Map<string, string> = new Map();

  setHtmlForUrl(url: string, html: string): void {
    this.urlToHtml.set(url, html);
  }

  loadFixture(url: string, fixturePath: string): void {
    const fullPath = path.join(__dirname, '..', 'fixtures', fixturePath);
    const html = fs.readFileSync(fullPath, 'utf-8');
    this.urlToHtml.set(url, html);
  }

  clearAll(): void {
    this.urlToHtml.clear();
  }

  async getPageContent(url: string, _options?: FetchOptions): Promise<string> {
    const html = this.urlToHtml.get(url);
    if (!html) {
      throw new Error(`No mock HTML configured for URL: ${url}`);
    }
    return html;
  }

  async getPageContentWithInfo(url: string, options?: FetchOptions): Promise<FetchResult> {
    const html = await this.getPageContent(url, options);
    return {
      html,
      usedPlaywright: options?.forcePlaywright || false,
      contentLength: html.length,
      stealthLevel: options?.stealthLevel || StealthLevel.NONE,
      blocked: false,
    };
  }

  async close(): Promise<void> {
    // No-op for mock
  }
}
