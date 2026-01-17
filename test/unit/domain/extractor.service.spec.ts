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
});
