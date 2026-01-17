import { IAiClient, AiResponse } from '../../src/domain/interfaces';

export class MockGeminiClient implements IAiClient {
  private responses: Map<string, string> = new Map();

  setResponse(promptContains: string, response: string): void {
    this.responses.set(promptContains, response);
  }

  async generate(prompt: string): Promise<AiResponse> {
    for (const [key, value] of this.responses.entries()) {
      if (prompt.includes(key)) {
        return {
          content: value,
          usage: { promptTokens: 100, completionTokens: 50 },
        };
      }
    }

    if (prompt.includes('페이지 유형을 판별')) {
      return {
        content: JSON.stringify({
          pageType: 'LISTING',
          confidence: 0.95,
          reasoning: 'Multiple product cards detected',
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      };
    }

    if (prompt.includes('목록 페이지')) {
      return {
        content: JSON.stringify({
          productCard: "//li[contains(@class, 'search-product')]",
          thumbnail: ".//img[@class='thumbnail']/@src",
          name: ".//div[@class='name']/text()",
          price: ".//span[@class='price-value']/text()",
          url: ".//a[@class='product-link']/@href",
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      };
    }

    if (prompt.includes('상품 상세 페이지')) {
      return {
        content: JSON.stringify({
          brandName: "//span[@class='brand']/text()",
          productName: "//h1[@class='product-title']/text()",
          price: "//span[@class='sale-price']/text()",
          description: "//div[@class='product-description']",
          options: "//select[@class='option-select']/option/text()",
          detailImages: "//div[@class='detail-images']//img/@src",
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      };
    }

    throw new Error('Unexpected prompt');
  }
}
