import { AiResponse, IAiClient } from '../../src/domain/interfaces';

export class MockGeminiClient implements IAiClient {
  private responses: Map<string, string> = new Map();

  setResponse(promptContains: string, response: string): void {
    this.responses.set(promptContains, response);
  }

  clearResponses(): void {
    this.responses.clear();
  }

  async generate(prompt: string): Promise<AiResponse> {
    // Check custom responses first
    for (const [key, value] of this.responses.entries()) {
      if (prompt.includes(key)) {
        return {
          content: value,
          usage: { promptTokens: 100, completionTokens: 50 },
        };
      }
    }

    // Default responses for page type detection
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

    // Default response for listing XPath generation
    if (prompt.includes('목록 페이지')) {
      return {
        content: JSON.stringify({
          productCard: "//li[contains(@class, 'search-product')]",
          thumbnail: ".//img[@class='thumbnail']/@src",
          name: ".//div[@class='name']",
          price: ".//span[@class='price-value']",
          url: ".//a[@class='product-link']/@href",
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      };
    }

    // Default response for PDP XPath generation
    if (prompt.includes('상품 상세 페이지')) {
      return {
        content: JSON.stringify({
          brandName: "//span[@class='brand']",
          productName: "//h1[@class='product-title']",
          price: "//span[@class='sale-price']",
          description: "//div[@class='product-description']",
          options: "//select[@class='option-select']/option",
          detailImages: "//div[@class='detail-images']//img/@src",
        }),
        usage: { promptTokens: 100, completionTokens: 50 },
      };
    }

    throw new Error('Unexpected prompt');
  }
}
