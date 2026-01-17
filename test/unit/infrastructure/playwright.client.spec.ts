import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CrawlException } from '../../../src/common/exceptions/crawl.exception';

// Mock playwright-extra BEFORE importing PlaywrightClient
const mockPage = {
  goto: jest.fn(),
  content: jest.fn(),
  title: jest.fn(),
  close: jest.fn(),
  waitForTimeout: jest.fn(),
  evaluate: jest.fn(),
};

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn(),
};

const mockBrowser = {
  newContext: jest.fn(),
  close: jest.fn(),
};

const mockLaunch = jest.fn();

jest.mock('playwright-extra', () => ({
  chromium: {
    use: jest.fn(),
    launch: mockLaunch,
  },
}));

jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks are set up
import { PlaywrightClient } from '../../../src/infrastructure/browser/playwright.client';

describe('PlaywrightClient', () => {
  let playwrightClient: PlaywrightClient;
  let mockConfigService: jest.Mocked<ConfigService>;

  // Sample valid HTML with product content
  const validHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>Product Page</title></head>
    <body>
      <div class="product">
        <h1>Test Product</h1>
        <span class="price">10,000원</span>
        <div class="description">상품 설명입니다.</div>
      </div>
    </body>
    </html>
  `.repeat(100); // Make it long enough to pass MIN_VALID_HTML_LENGTH

  const blockedHtml = '<html><head><title>Access Denied</title></head><body>Blocked</body></html>';
  const shortHtml = '<html><body>Short</body></html>';

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset mock implementations
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.content.mockResolvedValue(validHtml);
    mockPage.title.mockResolvedValue('Test Page');
    mockPage.close.mockResolvedValue(undefined);
    mockPage.waitForTimeout.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue(undefined);
    mockContext.newPage.mockResolvedValue(mockPage);
    mockContext.close.mockResolvedValue(undefined);
    mockBrowser.newContext.mockResolvedValue(mockContext);
    mockBrowser.close.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue(mockBrowser);

    // Reset fetch mock
    mockFetch.mockReset();

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'browser.headless') return true;
        if (key === 'browser.timeout') return 30000;
        return defaultValue;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaywrightClient,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    playwrightClient = module.get<PlaywrightClient>(PlaywrightClient);
  });

  afterEach(async () => {
    await playwrightClient.close();
  });

  describe('constructor', () => {
    it('should use default values when config is not provided', () => {
      const configService = {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as jest.Mocked<ConfigService>;

      // Should not throw
      expect(() => new PlaywrightClient(configService)).not.toThrow();
    });
  });

  describe('getPageContent with HTTP fetch', () => {
    it('should use HTTP fetch first when response is valid', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(validHtml),
      });

      const result = await playwrightClient.getPageContent('https://example.com');

      expect(result).toBe(validHtml);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('should fallback to Playwright when HTTP response is too short', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(shortHtml),
      });

      const result = await playwrightClient.getPageContent('https://example.com');

      expect(result).toBe(validHtml); // Playwright returns validHtml
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });

    it('should fallback to Playwright when HTTP fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await playwrightClient.getPageContent('https://example.com');

      expect(result).toBe(validHtml);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });

    it('should fallback to Playwright when HTTP returns non-OK status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const result = await playwrightClient.getPageContent('https://example.com');

      expect(result).toBe(validHtml);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPageContent with forcePlaywright option', () => {
    it('should skip HTTP fetch when forcePlaywright is true', async () => {
      const result = await playwrightClient.getPageContent('https://example.com', {
        forcePlaywright: true,
      });

      expect(result).toBe(validHtml);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPageContentWithInfo', () => {
    it('should return usedPlaywright: false when HTTP fetch succeeds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(validHtml),
      });

      const result = await playwrightClient.getPageContentWithInfo('https://example.com');

      expect(result.usedPlaywright).toBe(false);
      expect(result.html).toBe(validHtml);
      expect(result.contentLength).toBe(validHtml.length);
    });

    it('should return usedPlaywright: true when falling back to Playwright', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await playwrightClient.getPageContentWithInfo('https://example.com');

      expect(result.usedPlaywright).toBe(true);
      expect(result.html).toBe(validHtml);
    });
  });

  describe('getPageContent with Playwright', () => {
    beforeEach(() => {
      // Make HTTP fetch fail to test Playwright path
      mockFetch.mockRejectedValue(new Error('Network error'));
    });

    it('should navigate to the provided URL', async () => {
      const testUrl = 'https://example.com/products';

      await playwrightClient.getPageContent(testUrl);

      expect(mockPage.goto).toHaveBeenCalledWith(testUrl, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
    });

    it('should launch browser only once for multiple requests', async () => {
      await playwrightClient.getPageContent('https://example.com/page1');
      await playwrightClient.getPageContent('https://example.com/page2');

      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });

    it('should close page after getting content', async () => {
      await playwrightClient.getPageContent('https://example.com');

      expect(mockPage.close).toHaveBeenCalled();
    });

    it('should throw CrawlException on navigation error', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation timeout'));

      await expect(
        playwrightClient.getPageContent('https://example.com'),
      ).rejects.toThrow(CrawlException);
    });

    it('should include URL in CrawlException', async () => {
      mockPage.goto.mockRejectedValue(new Error('Connection refused'));

      try {
        await playwrightClient.getPageContent('https://blocked-site.com');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CrawlException);
        expect((error as CrawlException).url).toBe('https://blocked-site.com');
      }
    });

    it('should detect blocked pages by title', async () => {
      mockPage.title.mockResolvedValue('Access Denied');
      mockPage.content.mockResolvedValue(blockedHtml);

      // Should still return content even if blocked (let caller handle it)
      const result = await playwrightClient.getPageContent('https://example.com');

      expect(result).toBe(blockedHtml);
    });

    it('should simulate human-like behavior with scrolling', async () => {
      await playwrightClient.getPageContent('https://example.com');

      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(mockPage.waitForTimeout).toHaveBeenCalled();
    });

    it('should close page even when content retrieval fails', async () => {
      mockPage.content.mockRejectedValue(new Error('Content error'));

      try {
        await playwrightClient.getPageContent('https://example.com');
      } catch {
        // Expected to throw
      }

      expect(mockPage.close).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    beforeEach(() => {
      // Make HTTP fetch fail to test Playwright path
      mockFetch.mockRejectedValue(new Error('Network error'));
    });

    it('should close browser and context', async () => {
      // First, ensure browser is launched
      await playwrightClient.getPageContent('https://example.com');

      await playwrightClient.close();

      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle close when browser is not launched', async () => {
      // Should not throw
      await expect(playwrightClient.close()).resolves.not.toThrow();
    });

    it('should be safe to call multiple times', async () => {
      await playwrightClient.getPageContent('https://example.com');

      await playwrightClient.close();
      await playwrightClient.close();

      // Should only close once
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('onModuleDestroy', () => {
    beforeEach(() => {
      mockFetch.mockRejectedValue(new Error('Network error'));
    });

    it('should close browser on module destroy', async () => {
      await playwrightClient.getPageContent('https://example.com');

      await playwrightClient.onModuleDestroy();

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });
});
