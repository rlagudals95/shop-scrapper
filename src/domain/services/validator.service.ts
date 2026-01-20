import { Injectable } from '@nestjs/common';
import {
  PageType,
  ExtractedData,
  ListingData,
  PDPData,
  SelectorMap,
  isListingData,
} from '../entities';
import { ValidationError } from '@/common';
import { createLogger, isEmpty } from '@/common';
import { ExtractionQuality } from './extractor.service';

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

  /**
   * 품질 기반 피드백 생성 (더 구체적인 피드백)
   * - 추출 품질 지표와 현재 셀렉터를 기반으로 개선 방향 제시
   */
  generateQualityFeedback(
    quality: ExtractionQuality,
    selectors: SelectorMap,
  ): string {
    const issues: string[] = [];

    // 유효 상품 비율 문제
    if (quality.qualityScore < 50) {
      issues.push(
        `name 또는 url이 누락된 상품이 ${100 - quality.qualityScore}%입니다.`,
      );
      if (selectors.name) {
        issues.push(
          `현재 name 셀렉터: "${selectors.name}" - 더 정확한 셀렉터가 필요합니다.`,
        );
      }
    }

    // 가격 추출 문제 (할인율 vs 실제 가격)
    if (quality.priceValidProducts < quality.totalProducts * 0.3) {
      issues.push(
        `가격 추출이 실패했습니다. 현재 셀렉터가 할인율(%)을 추출하고 있을 수 있습니다.`,
      );
      if (selectors.price) {
        issues.push(`현재 price 셀렉터: "${selectors.price}"`);
      }
      issues.push(
        `실제 판매 가격(예: "10,630원")을 포함하는 요소를 선택해주세요.`,
      );
      issues.push(`할인율(예: "29%")이 아닌 최종 가격 요소를 타겟팅하세요.`);
    }

    // 상품 수 부족
    if (quality.totalProducts < 5) {
      issues.push(
        `추출된 상품이 ${quality.totalProducts}개로 너무 적습니다.`,
      );
      if (selectors.productCard) {
        issues.push(`현재 productCard 셀렉터: "${selectors.productCard}"`);
      }
      issues.push(`더 많은 상품을 포함하는 상위 컨테이너를 선택해주세요.`);
    }

    return [
      '## 이전 셀렉터 분석 결과가 품질 기준을 충족하지 못했습니다.',
      '',
      '### 추출 결과:',
      `- 총 상품: ${quality.totalProducts}개`,
      `- 유효 상품: ${quality.validProducts}개 (${quality.qualityScore}%)`,
      `- 가격 유효: ${quality.priceValidProducts}개`,
      '',
      '### 문제점:',
      ...issues.map((i) => `- ${i}`),
      '',
      '### 요청사항:',
      '- 가격은 반드시 "XX,XXX원" 형태의 실제 판매 가격을 추출해야 합니다.',
      '- 할인율(%)이 아닌 최종 가격 요소를 선택하세요.',
      '- 상품명은 실제 상품 타이틀을 포함하는 가장 구체적인 요소를 선택하세요.',
    ].join('\n');
  }
}
