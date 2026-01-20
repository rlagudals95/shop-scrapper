import { Test, TestingModule } from '@nestjs/testing';
import { AnalyzerService } from '../../../src/domain/services/analyzer.service';
import { IAiClient, AiResponse } from '../../../src/domain/interfaces';
import { INJECTION_TOKENS } from '../../../src/common';
import { PageType } from '../../../src/domain/entities';
import { AnalysisException } from '../../../src/common/exceptions/crawl.exception';

describe('AnalyzerService', () => {
  let analyzerService: AnalyzerService;
  let mockAiClient: jest.Mocked<IAiClient>;

  beforeEach(async () => {
    mockAiClient = {
      generate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyzerService,
        {
          provide: INJECTION_TOKENS.AI_CLIENT,
          useValue: mockAiClient,
        },
      ],
    }).compile();

    analyzerService = module.get<AnalyzerService>(AnalyzerService);
  });

  describe('analyze', () => {
    it('should detect LISTING page type and generate XPaths', async () => {
      // Mock page type detection
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: JSON.stringify({
            pageType: 'LISTING',
            confidence: 0.95,
            reasoning: 'Multiple product cards detected',
          }),
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        // Mock XPath generation
        .mockResolvedValueOnce({
          content: JSON.stringify({
            productCard: "//div[@class='product']",
            name: ".//span[@class='name']",
            price: ".//span[@class='price']",
            url: ".//a/@href",
            thumbnail: ".//img/@src",
          }),
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const result = await analyzerService.analyze('<html><body>test</body></html>');

      expect(result.pageType).toBe(PageType.LISTING);
      expect(result.confidence).toBe(0.95);
      expect(result.selectors).toHaveProperty('productCard');
    });

    it('should detect PDP page type and generate XPaths', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: JSON.stringify({
            pageType: 'PDP',
            confidence: 0.9,
            reasoning: 'Single product detail page detected',
          }),
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            productName: "//h1[@class='title']",
            price: "//span[@class='price']",
            brandName: "//span[@class='brand']",
            description: "//div[@class='desc']",
            options: "//select/option",
            detailImages: "//div[@class='images']//img/@src",
          }),
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const result = await analyzerService.analyze('<html><body>product detail</body></html>');

      expect(result.pageType).toBe(PageType.PDP);
      expect(result.confidence).toBe(0.9);
      expect(result.selectors).toHaveProperty('productName');
    });

    it('should throw AnalysisException when confidence is too low', async () => {
      mockAiClient.generate.mockResolvedValueOnce({
        content: JSON.stringify({
          pageType: 'LISTING',
          confidence: 0.5, // Below 0.7 threshold
          reasoning: 'Uncertain page type',
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      await expect(analyzerService.analyze('<html><body>test</body></html>')).rejects.toThrow(
        AnalysisException,
      );
    });

    it('should throw AnalysisException when page type response is invalid JSON', async () => {
      mockAiClient.generate.mockResolvedValueOnce({
        content: 'This is not valid JSON',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      await expect(analyzerService.analyze('<html><body>test</body></html>')).rejects.toThrow(
        AnalysisException,
      );
    });

    it('should pass feedback to XPath generation when provided', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: JSON.stringify({
            pageType: 'LISTING',
            confidence: 0.95,
            reasoning: 'test',
          }),
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            productCard: "//div[@class='product']",
            name: ".//span",
            price: ".//span",
            url: ".//a/@href",
            thumbnail: ".//img/@src",
          }),
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const feedback = 'Previous XPath failed for price field';
      await analyzerService.analyze('<html><body>test</body></html>', feedback);

      // Check that the second call (XPath generation) includes feedback
      const secondCallPrompt = mockAiClient.generate.mock.calls[1][0];
      expect(secondCallPrompt).toContain(feedback);
    });
  });

  describe('analyzeWithKnownType', () => {
    it('should skip page type detection when type is provided', async () => {
      mockAiClient.generate.mockResolvedValueOnce({
        content: JSON.stringify({
          productCard: "//div[@class='product']",
          name: ".//span[@class='name']",
          price: ".//span[@class='price']",
          url: ".//a/@href",
          thumbnail: ".//img/@src",
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await analyzerService.analyzeWithKnownType(
        '<html><body>test</body></html>',
        PageType.LISTING,
      );

      expect(result.pageType).toBe(PageType.LISTING);
      expect(result.confidence).toBe(1.0);
      expect(mockAiClient.generate).toHaveBeenCalledTimes(1); // Only XPath generation
    });

    it('should generate PDP XPaths when type is PDP', async () => {
      mockAiClient.generate.mockResolvedValueOnce({
        content: JSON.stringify({
          productName: "//h1[@class='title']",
          price: "//span[@class='price']",
          brandName: null,
          description: "//div[@class='desc']",
          options: "//select/option",
          detailImages: "//div[@class='images']//img/@src",
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await analyzerService.analyzeWithKnownType(
        '<html><body>test</body></html>',
        PageType.PDP,
      );

      expect(result.pageType).toBe(PageType.PDP);
      expect(result.selectors).toHaveProperty('productName');
    });

    it('should include feedback in XPath generation prompt', async () => {
      mockAiClient.generate.mockResolvedValueOnce({
        content: JSON.stringify({
          productCard: "//div[@class='product']",
          name: ".//span",
          price: ".//span",
          url: ".//a/@href",
          thumbnail: ".//img/@src",
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const feedback = 'Fix the price XPath';
      await analyzerService.analyzeWithKnownType(
        '<html><body>test</body></html>',
        PageType.LISTING,
        feedback,
      );

      const prompt = mockAiClient.generate.mock.calls[0][0];
      expect(prompt).toContain(feedback);
    });
  });

  describe('parseJsonResponse (via analyze)', () => {
    it('should parse JSON wrapped in code blocks', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: '```json\n{"pageType": "LISTING", "confidence": 0.9, "reasoning": "test"}\n```',
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: '```\n{"productCard": "//div"}\n```',
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const result = await analyzerService.analyze('<html></html>');
      expect(result.pageType).toBe(PageType.LISTING);
    });

    it('should parse raw JSON without code blocks', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: '{"pageType": "PDP", "confidence": 0.85, "reasoning": "test"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: '{"productName": "//h1", "price": "//span"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const result = await analyzerService.analyze('<html></html>');
      expect(result.pageType).toBe(PageType.PDP);
    });

    it('should throw when no valid JSON found', async () => {
      mockAiClient.generate.mockResolvedValueOnce({
        content: 'No JSON here at all',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      await expect(analyzerService.analyze('<html></html>')).rejects.toThrow(AnalysisException);
    });

    it('should throw when XPath generation returns invalid JSON', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: '{"pageType": "LISTING", "confidence": 0.9, "reasoning": "test"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: 'Invalid JSON for XPaths',
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      await expect(analyzerService.analyze('<html></html>')).rejects.toThrow(AnalysisException);
    });
  });

  describe('simplifyHtml (via analyze)', () => {
    it('should remove script tags', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: '{"pageType": "LISTING", "confidence": 0.9, "reasoning": "test"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: '{"productCard": "//div"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const htmlWithScript = `
        <html>
          <head><script>console.log("test");</script></head>
          <body><div class="product">Product</div></body>
        </html>
      `;

      await analyzerService.analyze(htmlWithScript);

      // The prompt should not contain script content
      const prompt = mockAiClient.generate.mock.calls[0][0];
      expect(prompt).not.toContain('console.log');
    });

    it('should remove style tags', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: '{"pageType": "LISTING", "confidence": 0.9, "reasoning": "test"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: '{"productCard": "//div"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const htmlWithStyle = `
        <html>
          <head><style>.product { color: red; }</style></head>
          <body><div class="product">Product</div></body>
        </html>
      `;

      await analyzerService.analyze(htmlWithStyle);

      const prompt = mockAiClient.generate.mock.calls[0][0];
      expect(prompt).not.toContain('color: red');
    });

    it('should remove HTML comments', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: '{"pageType": "LISTING", "confidence": 0.9, "reasoning": "test"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: '{"productCard": "//div"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const htmlWithComments = `
        <html>
          <!-- This is a comment -->
          <body><div class="product">Product</div></body>
        </html>
      `;

      await analyzerService.analyze(htmlWithComments);

      const prompt = mockAiClient.generate.mock.calls[0][0];
      expect(prompt).not.toContain('This is a comment');
    });

    it('should preserve important attributes (class, id, href, src)', async () => {
      mockAiClient.generate
        .mockResolvedValueOnce({
          content: '{"pageType": "LISTING", "confidence": 0.9, "reasoning": "test"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: '{"productCard": "//div"}',
          usage: { promptTokens: 100, completionTokens: 50 },
        });

      const htmlWithAttrs = `
        <html>
          <body>
            <div class="product" id="main" data-test="remove">
              <a href="/product/1">Link</a>
              <img src="/img.jpg" alt="Product" />
            </div>
          </body>
        </html>
      `;

      await analyzerService.analyze(htmlWithAttrs);

      const prompt = mockAiClient.generate.mock.calls[0][0];
      expect(prompt).toContain('class="product"');
      expect(prompt).toContain('id="main"');
      expect(prompt).toContain('href="/product/1"');
      expect(prompt).toContain('src="/img.jpg"');
    });
  });
});
