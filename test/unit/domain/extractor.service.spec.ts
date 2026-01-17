import { ExtractorService } from '../../../src/domain/services/extractor.service';
import { PageType, ListingXPathMap, PDPXPathMap, ListingData, PDPData } from '../../../src/domain/entities';
import * as fs from 'fs';
import * as path from 'path';

describe('ExtractorService', () => {
  let extractorService: ExtractorService;
  let listingHtml: string;
  let pdpHtml: string;

  beforeAll(() => {
    listingHtml = fs.readFileSync(
      path.join(__dirname, '../../fixtures/coupang-listing.html'),
      'utf-8',
    );
    pdpHtml = fs.readFileSync(
      path.join(__dirname, '../../fixtures/coupang-pdp.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    extractorService = new ExtractorService();
  });

  describe('extract Listing data', () => {
    const listingXPaths: ListingXPathMap = {
      productCard: "//li[contains(@class, 'search-product')]",
      thumbnail: ".//img[@class='thumbnail']/@src",
      name: ".//div[@class='name']",
      price: ".//span[@class='price-value']",
      url: ".//a[@class='product-link']/@href",
    };

    it('should extract products from listing page', () => {
      const result = extractorService.extract(
        listingHtml,
        listingXPaths,
        PageType.LISTING,
      ) as ListingData;

      expect(result.products).toBeDefined();
      expect(result.products.length).toBe(3);
    });

    it('should extract product names correctly', () => {
      const result = extractorService.extract(
        listingHtml,
        listingXPaths,
        PageType.LISTING,
      ) as ListingData;

      expect(result.products[0].name).toContain('Samsung Galaxy S24 Ultra');
      expect(result.products[1].name).toContain('Apple iPhone 15 Pro Max');
      expect(result.products[2].name).toContain('Google Pixel 8 Pro');
    });

    it('should extract prices correctly', () => {
      const result = extractorService.extract(
        listingHtml,
        listingXPaths,
        PageType.LISTING,
      ) as ListingData;

      expect(result.products[0].price).toContain('1,299,000');
      expect(result.products[1].price).toContain('1,890,000');
      expect(result.products[2].price).toContain('899,000');
    });

    it('should extract URLs correctly', () => {
      const result = extractorService.extract(
        listingHtml,
        listingXPaths,
        PageType.LISTING,
      ) as ListingData;

      expect(result.products[0].url).toBe('/vp/products/12345');
      expect(result.products[1].url).toBe('/vp/products/12346');
      expect(result.products[2].url).toBe('/vp/products/12347');
    });

    it('should extract thumbnail URLs correctly', () => {
      const result = extractorService.extract(
        listingHtml,
        listingXPaths,
        PageType.LISTING,
      ) as ListingData;

      expect(result.products[0].thumbnail).toBe(
        'https://example.com/images/product1.jpg',
      );
    });

    it('should return empty products array for invalid XPaths', () => {
      const invalidXPaths: ListingXPathMap = {
        productCard: '//nonexistent-element',
        thumbnail: './/img/@src',
        name: './/span/text()',
        price: './/div/text()',
        url: './/a/@href',
      };

      const result = extractorService.extract(
        listingHtml,
        invalidXPaths,
        PageType.LISTING,
      ) as ListingData;

      expect(result.products).toHaveLength(0);
    });
  });

  describe('extract PDP data', () => {
    const pdpXPaths: PDPXPathMap = {
      brandName: "//span[@class='brand']",
      productName: "//h1[@class='product-title']",
      price: "//span[@class='sale-price']",
      description: "//div[@class='product-description']",
      options: "//select[@class='option-select']/option",
      detailImages: "//div[@class='detail-images']//img/@src",
    };

    it('should extract product name correctly', () => {
      const result = extractorService.extract(
        pdpHtml,
        pdpXPaths,
        PageType.PDP,
      ) as PDPData;

      expect(result.productName).toContain('Samsung Galaxy S24 Ultra');
    });

    it('should extract brand name correctly', () => {
      const result = extractorService.extract(
        pdpHtml,
        pdpXPaths,
        PageType.PDP,
      ) as PDPData;

      expect(result.brandName).toBe('Samsung');
    });

    it('should extract price correctly', () => {
      const result = extractorService.extract(
        pdpHtml,
        pdpXPaths,
        PageType.PDP,
      ) as PDPData;

      expect(result.price).toContain('1,299,000');
    });

    it('should extract options correctly', () => {
      const result = extractorService.extract(
        pdpHtml,
        pdpXPaths,
        PageType.PDP,
      ) as PDPData;

      expect(result.options.length).toBeGreaterThan(0);
      expect(result.options).toContain('Titanium Black');
    });

    it('should extract detail images correctly', () => {
      const result = extractorService.extract(
        pdpHtml,
        pdpXPaths,
        PageType.PDP,
      ) as PDPData;

      expect(result.detailImages.length).toBe(3);
      expect(result.detailImages[0]).toBe('https://example.com/detail/detail1.jpg');
    });
  });
});
