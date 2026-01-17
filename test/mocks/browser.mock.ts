import { IBrowserClient } from '../../src/domain/interfaces';
import * as fs from 'fs';
import * as path from 'path';

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

  async getPageContent(url: string): Promise<string> {
    const html = this.urlToHtml.get(url);
    if (!html) {
      throw new Error(`No mock HTML configured for URL: ${url}`);
    }
    return html;
  }

  async close(): Promise<void> {
    // No-op for mock
  }
}
