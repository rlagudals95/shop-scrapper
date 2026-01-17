import { Injectable } from '@nestjs/common';
import {
  PageType,
  ExtractedData,
  ListingData,
  PDPData,
  isListingData,
} from '../entities';
import { ValidationError } from '@/common';
import { createLogger, isEmpty } from '@/common';

export interface ValidationRule {
  field: string;
  required: boolean;
  type: 'string' | 'number' | 'url' | 'array';
  pattern?: RegExp;
  minLength?: number;
  minItems?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
  score: number;
}

@Injectable()
export class ValidatorService {
  private readonly logger = createLogger(ValidatorService.name);

  private readonly listingRules: ValidationRule[] = [
    { field: 'products', required: true, type: 'array', minItems: 1 },
  ];

  private readonly listingProductRules: ValidationRule[] = [
    { field: 'name', required: true, type: 'string', minLength: 1 },
    { field: 'price', required: true, type: 'string', pattern: /[\d,]+/ },
    { field: 'url', required: true, type: 'string' },
    { field: 'thumbnail', required: false, type: 'string' },
  ];

  private readonly pdpRules: ValidationRule[] = [
    { field: 'productName', required: true, type: 'string', minLength: 1 },
    { field: 'price', required: true, type: 'string', pattern: /[\d,]+/ },
    { field: 'brandName', required: false, type: 'string' },
    { field: 'description', required: false, type: 'string' },
    { field: 'options', required: false, type: 'array' },
    { field: 'detailImages', required: false, type: 'array' },
  ];

  validate(data: ExtractedData, pageType: PageType): ValidationResult {
    if (pageType === PageType.LISTING && isListingData(data)) {
      return this.validateListing(data);
    } else {
      return this.validatePDP(data as PDPData);
    }
  }

  private validateListing(data: ListingData): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!data.products || data.products.length === 0) {
      errors.push({ field: 'products', message: 'No products found' });
      return { isValid: false, errors, warnings, score: 0 };
    }

    let validProductCount = 0;
    for (let i = 0; i < data.products.length; i++) {
      const product = data.products[i];
      const productErrors = this.validateObject(
        product,
        this.listingProductRules,
        `products[${i}]`,
      );

      if (productErrors.length === 0) {
        validProductCount++;
      } else {
        if (i < 3) {
          errors.push(...productErrors);
        }
      }
    }

    if (validProductCount === 0) {
      errors.push({ field: 'products', message: 'No valid products found' });
    }

    const score = Math.round((validProductCount / data.products.length) * 100);

    if (validProductCount < data.products.length) {
      warnings.push(
        `${data.products.length - validProductCount} products have incomplete data`,
      );
    }

    return {
      isValid: validProductCount > 0 && errors.length === 0,
      errors,
      warnings,
      score,
    };
  }

  private validatePDP(data: PDPData): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    const pdpErrors = this.validateObject(data, this.pdpRules, '');
    errors.push(...pdpErrors);

    const totalFields = this.pdpRules.length;
    const requiredFields = this.pdpRules.filter((r) => r.required).length;
    const requiredErrors = errors.filter((e) =>
      this.pdpRules.find((r) => r.required && e.field === r.field),
    ).length;

    let filledOptional = 0;
    for (const rule of this.pdpRules) {
      if (!rule.required) {
        const value = this.getNestedValue(data as unknown as Record<string, unknown>, rule.field);
        if (!isEmpty(value)) {
          filledOptional++;
        }
      }
    }

    const requiredScore =
      requiredFields > 0
        ? ((requiredFields - requiredErrors) / requiredFields) * 70
        : 70;
    const optionalScore =
      (filledOptional / (totalFields - requiredFields)) * 30;
    const score = Math.round(requiredScore + optionalScore);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score,
    };
  }

  private validateObject(
    obj: object,
    rules: ValidationRule[],
    prefix: string,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const fieldPath = prefix ? `${prefix}.${rule.field}` : rule.field;
      const value = this.getNestedValue(obj as Record<string, unknown>, rule.field);

      if (rule.required && isEmpty(value)) {
        errors.push({ field: fieldPath, message: 'Required field is empty' });
        continue;
      }

      if (!isEmpty(value)) {
        if (!this.checkType(value, rule.type)) {
          errors.push({
            field: fieldPath,
            message: `Expected ${rule.type}`,
          });
        }

        if (rule.pattern && typeof value === 'string') {
          if (!rule.pattern.test(value)) {
            errors.push({ field: fieldPath, message: 'Pattern mismatch' });
          }
        }

        if (rule.minLength && typeof value === 'string') {
          if (value.length < rule.minLength) {
            errors.push({
              field: fieldPath,
              message: `Minimum length is ${rule.minLength}`,
            });
          }
        }

        if (rule.minItems && Array.isArray(value)) {
          if (value.length < rule.minItems) {
            errors.push({
              field: fieldPath,
              message: `Expected at least ${rule.minItems} items`,
            });
          }
        }
      }
    }

    return errors;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  private checkType(value: unknown, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'url':
        return typeof value === 'string' && this.isValidUrl(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }

  private isValidUrl(str: string): boolean {
    if (str.startsWith('/') || str.startsWith('./')) return true;
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }

  generateRecoveryFeedback(validation: ValidationResult): string {
    const feedback = [
      '이전 XPath 분석이 실패했습니다. 다음 문제를 수정해주세요:',
      '',
      ...validation.errors.map((e) => `- ${e.field}: ${e.message}`),
      '',
      '새로운 XPath를 생성할 때 위 필드들에 특히 주의해주세요.',
    ];

    return feedback.join('\n');
  }
}
