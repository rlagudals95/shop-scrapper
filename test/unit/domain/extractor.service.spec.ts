import { Test, TestingModule } from '@nestjs/testing';
import { ListingXPathMap, PageType, PDPXPathMap } from '../../../src/domain/entities';
import { ExtractorService } from '../../../src/domain/services/extractor.service';

describe('ExtractorService', () => {
  let extractorService: ExtractorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExtractorService],
    }).compile();

    extractorService = module.get<ExtractorService>(ExtractorService);
  });

  describe('extract', () => {
    it('should call extractListing for LISTING page type', () => {
      const html = `
        <html>
          <body>
            <div class="product-item">
              <a class="name" href="/product/1">Test Product</a>
              <span class="price">10,000원</span>
            </div>
          </body>
        </html>
      `;

      const xpaths: ListingXPathMap = {
        productCard: "//div[contains(@class, 'product-item')]",
        name: ".//a[contains(@class, 'name')]/text()",
        price: ".//span[contains(@class, 'price')]/text()",
        url: ".//a/@href",
        thumbnail: '',
      };

      const result = extractorService.extract(html, xpaths, PageType.LISTING);
      expect(result).toHaveProperty('products');
    });

    it('should call extractPDP for PDP page type', () => {
      const html = `
        <html>
          <body>
            <h1 class="product-name">Test Product</h1>
            <span class="price">10,000원</span>
          </body>
        </html>
      `;

      const xpaths: PDPXPathMap = {
        productName: "//h1[contains(@class, 'product-name')]",
        price: "//span[contains(@class, 'price')]",
      };

      const result = extractorService.extract(html, xpaths, PageType.PDP);
      expect(result).toHaveProperty('productName');
      expect(result).toHaveProperty('price');
    });
  });

  describe('extractListing', () => {
    const listingHtml = `
      <html>
        <body>
          <div class="product-list">
            <div class="product-card">
              <a class="title" href="/products/1">Product 1</a>
              <span class="price">10,000원</span>
              <img class="thumb" src="http://example.com/1.jpg">
            </div>
            <div class="product-card">
              <a class="title" href="/products/2">Product 2</a>
              <span class="price">20,000원</span>
              <img class="thumb" src="http://example.com/2.jpg">
            </div>
          </div>
        </body>
      </html>
    `;

    it('should extract multiple products from listing page', () => {
      const xpaths: ListingXPathMap = {
        productCard: "//div[contains(@class, 'product-card')]",
        name: ".//a[contains(@class, 'title')]",
        price: ".//span[contains(@class, 'price')]",
        url: ".//a/@href",
        thumbnail: ".//img/@src",
      };

      const result = extractorService.extract(listingHtml, xpaths, PageType.LISTING);

      expect('products' in result).toBe(true);
      if ('products' in result) {
        expect(result.products.length).toBe(2);
        expect(result.products[0].name).toBe('Product 1');
        expect(result.products[0].price).toBe('10,000원');
        expect(result.products[1].name).toBe('Product 2');
      }
    });

    it('should return empty products array when no productCard xpath', () => {
      const xpaths: ListingXPathMap = {
        productCard: '',
        name: './/a',
        price: './/span',
        url: './/a/@href',
        thumbnail: '',
      };

      const result = extractorService.extract(listingHtml, xpaths, PageType.LISTING);

      expect('products' in result).toBe(true);
      if ('products' in result) {
        expect(result.products.length).toBe(0);
      }
    });

    it('should handle missing optional fields', () => {
      const xpaths: ListingXPathMap = {
        productCard: "//div[contains(@class, 'product-card')]",
        name: ".//a[contains(@class, 'title')]",
        price: ".//span[contains(@class, 'price')]",
        url: '',
        thumbnail: '',
      };

      const result = extractorService.extract(listingHtml, xpaths, PageType.LISTING);

      expect('products' in result).toBe(true);
      if ('products' in result) {
        expect(result.products.length).toBeGreaterThan(0);
        expect(result.products[0].thumbnail).toBeNull();
      }
    });
  });

  describe('extractPDP', () => {
    const pdpHtml = `
      <html>
        <body>
          <div class="product-detail">
            <span class="brand">Test Brand</span>
            <h1 class="product-name">Test Product Name</h1>
            <span class="price">15,000원</span>
            <div class="description">This is a test product description.</div>
            <select class="options">
              <option>Option 1</option>
              <option>Option 2</option>
            </select>
            <div class="detail-images">
              <img src="http://example.com/detail1.jpg">
              <img src="http://example.com/detail2.jpg">
            </div>
          </div>
        </body>
      </html>
    `;

    it('should extract all fields from PDP page', () => {
      const xpaths: PDPXPathMap = {
        brandName: "//span[contains(@class, 'brand')]",
        productName: "//h1[contains(@class, 'product-name')]",
        price: "//span[contains(@class, 'price')]",
        description: "//div[contains(@class, 'description')]",
        options: "//select[contains(@class, 'options')]/option",
        detailImages: "//div[contains(@class, 'detail-images')]//img/@src",
      };

      const result = extractorService.extract(pdpHtml, xpaths, PageType.PDP);

      expect('productName' in result).toBe(true);
      if ('productName' in result) {
        expect(result.brandName).toBe('Test Brand');
        expect(result.productName).toBe('Test Product Name');
        expect(result.price).toBe('15,000원');
        expect(result.description).toContain('test product description');
        expect(result.options).toContain('Option 1');
        expect(result.options).toContain('Option 2');
        expect(result.detailImages.length).toBe(2);
      }
    });

    it('should handle missing optional fields in PDP', () => {
      const xpaths: PDPXPathMap = {
        productName: "//h1[contains(@class, 'product-name')]",
        price: "//span[contains(@class, 'price')]",
      };

      const result = extractorService.extract(pdpHtml, xpaths, PageType.PDP);

      expect('productName' in result).toBe(true);
      if ('productName' in result) {
        expect(result.brandName).toBeNull();
        expect(result.productName).toBe('Test Product Name');
        expect(result.price).toBe('15,000원');
        expect(result.description).toBeNull();
        expect(result.options).toEqual([]);
        expect(result.detailImages).toEqual([]);
      }
    });
  });

  describe('xpathToSelector conversion', () => {
    it('should convert basic xpath to CSS selector', () => {
      const html = `
        <html>
          <body>
            <div class="test-class">Content</div>
          </body>
        </html>
      `;

      const xpaths: PDPXPathMap = {
        productName: "//div[contains(@class, 'test-class')]",
        price: "//div[contains(@class, 'test-class')]",
      };

      const result = extractorService.extract(html, xpaths, PageType.PDP);

      expect('productName' in result).toBe(true);
      if ('productName' in result) {
        expect(result.productName).toBe('Content');
      }
    });

    it('should handle id selectors', () => {
      const html = `
        <html>
          <body>
            <div id="product-title">Product Title</div>
          </body>
        </html>
      `;

      const xpaths: PDPXPathMap = {
        productName: "//div[@id='product-title']",
        price: "//div[@id='product-title']",
      };

      const result = extractorService.extract(html, xpaths, PageType.PDP);

      expect('productName' in result).toBe(true);
      if ('productName' in result) {
        expect(result.productName).toBe('Product Title');
      }
    });
  });

  describe('error handling', () => {
    it('should return empty data for invalid HTML', () => {
      const xpaths: ListingXPathMap = {
        productCard: "//div[contains(@class, 'product')]",
        name: './/span',
        price: './/span',
        url: '',
        thumbnail: '',
      };

      const result = extractorService.extract('', xpaths, PageType.LISTING);
      expect('products' in result).toBe(true);
      if ('products' in result) {
        expect(result.products.length).toBe(0);
      }
    });
  });

  describe('evaluateExtractionQuality', () => {
    it('should return 100% quality for all valid products with proper prices', () => {
      const data = {
        products: [
          { name: 'Product 1', price: '10,000원', url: '/p/1', thumbnail: null },
          { name: 'Product 2', price: '20,000원', url: '/p/2', thumbnail: null },
          { name: 'Product 3', price: '30,000원', url: '/p/3', thumbnail: null },
          { name: 'Product 4', price: '40,000원', url: '/p/4', thumbnail: null },
          { name: 'Product 5', price: '50,000원', url: '/p/5', thumbnail: null },
        ],
      };

      const quality = extractorService.evaluateExtractionQuality(data);

      expect(quality.totalProducts).toBe(5);
      expect(quality.validProducts).toBe(5);
      expect(quality.priceValidProducts).toBe(5);
      expect(quality.qualityScore).toBe(100);
    });

    it('should detect discount rate as invalid price', () => {
      const data = {
        products: [
          { name: 'Product 1', price: '29%', url: '/p/1', thumbnail: null },
          { name: 'Product 2', price: '44 %', url: '/p/2', thumbnail: null },
          { name: 'Product 3', price: '10%', url: '/p/3', thumbnail: null },
        ],
      };

      const quality = extractorService.evaluateExtractionQuality(data);

      expect(quality.totalProducts).toBe(3);
      expect(quality.validProducts).toBe(3); // name + url 있음
      expect(quality.priceValidProducts).toBe(0); // 할인율은 유효 가격 아님
    });

    it('should accept various valid price formats', () => {
      const data = {
        products: [
          { name: 'Product 1', price: '10,630원', url: '/p/1', thumbnail: null },
          { name: 'Product 2', price: '5,100원', url: '/p/2', thumbnail: null },
          { name: 'Product 3', price: '21,000', url: '/p/3', thumbnail: null },
          { name: 'Product 4', price: '1000원', url: '/p/4', thumbnail: null },
          { name: 'Product 5', price: '999', url: '/p/5', thumbnail: null },
        ],
      };

      const quality = extractorService.evaluateExtractionQuality(data);

      expect(quality.priceValidProducts).toBe(5);
    });

    it('should count products with missing name as invalid', () => {
      const data = {
        products: [
          { name: '', price: '10,000원', url: '/p/1', thumbnail: null },
          { name: '  ', price: '20,000원', url: '/p/2', thumbnail: null },
          { name: 'Valid Product', price: '30,000원', url: '/p/3', thumbnail: null },
        ],
      };

      const quality = extractorService.evaluateExtractionQuality(data);

      expect(quality.totalProducts).toBe(3);
      expect(quality.validProducts).toBe(1); // name + (price or url) 있는 것만
      expect(quality.qualityScore).toBe(33);
    });

    it('should return 0 quality for empty products', () => {
      const data = { products: [] };

      const quality = extractorService.evaluateExtractionQuality(data);

      expect(quality.totalProducts).toBe(0);
      expect(quality.validProducts).toBe(0);
      expect(quality.priceValidProducts).toBe(0);
      expect(quality.qualityScore).toBe(0);
    });
  });

  describe('isQualityAcceptable', () => {
    it('should accept quality with 80%+ valid and 50%+ price valid', () => {
      const quality = {
        totalProducts: 10,
        validProducts: 8,
        priceValidProducts: 5,
        qualityScore: 80,
      };

      expect(extractorService.isQualityAcceptable(quality)).toBe(true);
    });

    it('should reject quality with less than 5 products', () => {
      const quality = {
        totalProducts: 4,
        validProducts: 4,
        priceValidProducts: 4,
        qualityScore: 100,
      };

      expect(extractorService.isQualityAcceptable(quality)).toBe(false);
    });

    it('should reject quality with less than 80% valid', () => {
      const quality = {
        totalProducts: 10,
        validProducts: 7,
        priceValidProducts: 7,
        qualityScore: 70,
      };

      expect(extractorService.isQualityAcceptable(quality)).toBe(false);
    });

    it('should reject quality with less than 50% price valid', () => {
      const quality = {
        totalProducts: 10,
        validProducts: 10,
        priceValidProducts: 4, // 40% - below 50%
        qualityScore: 100,
      };

      expect(extractorService.isQualityAcceptable(quality)).toBe(false);
    });
  });
});
