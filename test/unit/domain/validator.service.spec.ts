import { ValidatorService } from '../../../src/domain/services/validator.service';
import { PageType, ListingData, PDPData } from '../../../src/domain/entities';

describe('ValidatorService', () => {
  let validatorService: ValidatorService;

  beforeEach(() => {
    validatorService = new ValidatorService();
  });

  describe('validate Listing data', () => {
    it('should validate valid listing data', () => {
      const data: ListingData = {
        products: [
          {
            name: 'Product 1',
            price: '10,000원',
            url: '/products/1',
            thumbnail: 'https://example.com/img1.jpg',
          },
          {
            name: 'Product 2',
            price: '20,000원',
            url: '/products/2',
            thumbnail: 'https://example.com/img2.jpg',
          },
        ],
      };

      const result = validatorService.validate(data, PageType.LISTING);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.score).toBe(100);
    });

    it('should fail when products array is empty', () => {
      const data: ListingData = {
        products: [],
      };

      const result = validatorService.validate(data, PageType.LISTING);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field === 'products')).toBe(true);
    });

    it('should fail when required fields are missing', () => {
      const data: ListingData = {
        products: [
          {
            name: '',
            price: '',
            url: '',
            thumbnail: null,
          },
        ],
      };

      const result = validatorService.validate(data, PageType.LISTING);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fail when price does not match pattern', () => {
      const data: ListingData = {
        products: [
          {
            name: 'Product 1',
            price: 'Free',
            url: '/products/1',
            thumbnail: null,
          },
        ],
      };

      const result = validatorService.validate(data, PageType.LISTING);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message === 'Pattern mismatch')).toBe(true);
    });
  });

  describe('validate PDP data', () => {
    it('should validate valid PDP data', () => {
      const data: PDPData = {
        brandName: 'Samsung',
        productName: 'Galaxy S24 Ultra',
        price: '1,299,000원',
        description: 'Latest flagship phone',
        options: ['Black', 'Gray', 'Violet'],
        detailImages: ['https://example.com/d1.jpg', 'https://example.com/d2.jpg'],
      };

      const result = validatorService.validate(data, PageType.PDP);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.score).toBeGreaterThan(70);
    });

    it('should fail when required fields are missing', () => {
      const data: PDPData = {
        brandName: null,
        productName: '',
        price: '',
        description: null,
        options: [],
        detailImages: [],
      };

      const result = validatorService.validate(data, PageType.PDP);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field === 'productName')).toBe(true);
      expect(result.errors.some((e) => e.field === 'price')).toBe(true);
    });

    it('should allow null for optional fields', () => {
      const data: PDPData = {
        brandName: null,
        productName: 'Product Name',
        price: '10,000원',
        description: null,
        options: [],
        detailImages: [],
      };

      const result = validatorService.validate(data, PageType.PDP);

      expect(result.isValid).toBe(true);
    });
  });

  describe('generateRecoveryFeedback', () => {
    it('should generate feedback message from validation errors', () => {
      const validationResult = {
        isValid: false,
        errors: [
          { field: 'productName', message: 'Required field is empty' },
          { field: 'price', message: 'Pattern mismatch' },
        ],
        warnings: [],
        score: 0,
      };

      const feedback = validatorService.generateRecoveryFeedback(validationResult);

      expect(feedback).toContain('productName');
      expect(feedback).toContain('price');
      expect(feedback).toContain('Required field is empty');
    });
  });
});
