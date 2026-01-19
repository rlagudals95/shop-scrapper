/**
 * 추출 결과 미리보기 스크립트
 *
 * 실행: npx ts-node scripts/preview-extraction.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtractorService } from '../src/domain/services/extractor.service';
import { HtmlFilterService } from '../src/domain/services/html-filter.service';
import { PageType, isListingData } from '../src/domain/entities';

const extractorService = new ExtractorService();
const htmlFilterService = new HtmlFilterService();

const FIXTURES_PATH = path.join(__dirname, '../test/fixtures');

async function main() {
  console.log('='.repeat(70));
  console.log('📦 커머스 크롤러 - 추출 결과 미리보기');
  console.log('='.repeat(70));

  // 쿠팡 HTML 로드
  const coupangHtmlPath = path.join(FIXTURES_PATH, 'coupang/html/list.html');

  if (!fs.existsSync(coupangHtmlPath)) {
    console.log('❌ 쿠팡 fixture 파일이 없습니다:', coupangHtmlPath);
    return;
  }

  const rawHtml = fs.readFileSync(coupangHtmlPath, 'utf-8');
  console.log(`\n📄 HTML 파일 크기: ${(rawHtml.length / 1024 / 1024).toFixed(2)} MB`);

  // HTML 필터링
  const filtered = htmlFilterService.filterForListing(rawHtml);
  console.log(`📄 필터링 후 크기: ${(filtered.filteredLength / 1024).toFixed(1)} KB (${filtered.compressionRatio}% 압축)`);

  // ========================================
  // 1. JSON-LD 추출
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('🔷 방법 1: JSON-LD 추출 (LLM 불필요)');
  console.log('='.repeat(70));

  const jsonLdResult = extractorService.extractWithFallback(rawHtml, null, PageType.LISTING);

  if (jsonLdResult.source === 'json-ld' && isListingData(jsonLdResult.data)) {
    console.log(`✅ 소스: ${jsonLdResult.source}`);
    console.log(`✅ 상품 수: ${jsonLdResult.productCount}개\n`);

    console.log('┌─────┬────────────────────────────────────────────────┬────────────┬───────────────────────────────┐');
    console.log('│ No. │ 상품명                                          │ 가격       │ URL                           │');
    console.log('├─────┼────────────────────────────────────────────────┼────────────┼───────────────────────────────┤');

    jsonLdResult.data.products.slice(0, 10).forEach((product, i) => {
      const name = product.name.substring(0, 40).padEnd(40);
      const price = product.price.padStart(10);
      const url = product.url.substring(0, 29).padEnd(29);
      console.log(`│ ${String(i + 1).padStart(3)} │ ${name} │ ${price} │ ${url} │`);
    });

    console.log('└─────┴────────────────────────────────────────────────┴────────────┴───────────────────────────────┘');

    if (jsonLdResult.productCount > 10) {
      console.log(`... 외 ${jsonLdResult.productCount - 10}개 상품`);
    }
  }

  // ========================================
  // 2. XPath 추출 (JSON-LD 제거 시뮬레이션)
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('🔶 방법 2: XPath 추출 (LLM 필요, JSON-LD 없을 때 fallback)');
  console.log('='.repeat(70));

  const htmlWithoutJsonLd = rawHtml.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, '');

  const xpathResult = extractorService.extractWithFallback(
    htmlWithoutJsonLd,
    {
      productCard: "//li[contains(@class, 'ProductUnit_productUnit')]",
      name: ".//div[contains(@class, 'ProductUnit_productNameV2')]",
      price: ".//div[contains(@class, 'PriceArea_priceArea')]//div[contains(@class, 'fw-font-bold')]",
      url: ".//a/@href",
      thumbnail: ".//figure//img/@src",
    },
    PageType.LISTING,
  );

  if (isListingData(xpathResult.data)) {
    console.log(`✅ 소스: ${xpathResult.source}`);
    console.log(`✅ 상품 수: ${xpathResult.productCount}개\n`);

    console.log('┌─────┬────────────────────────────────────────────────┬──────────────────────┬───────────────────────────────┐');
    console.log('│ No. │ 상품명                                          │ 가격                 │ URL                           │');
    console.log('├─────┼────────────────────────────────────────────────┼──────────────────────┼───────────────────────────────┤');

    xpathResult.data.products.slice(0, 10).forEach((product, i) => {
      const name = product.name.substring(0, 40).padEnd(40);
      const price = product.price.substring(0, 20).padStart(20);
      const url = (product.url || '').substring(0, 29).padEnd(29);
      console.log(`│ ${String(i + 1).padStart(3)} │ ${name} │ ${price} │ ${url} │`);
    });

    console.log('└─────┴────────────────────────────────────────────────┴──────────────────────┴───────────────────────────────┘');

    if (xpathResult.productCount > 10) {
      console.log(`... 외 ${xpathResult.productCount - 10}개 상품`);
    }
  }

  // ========================================
  // 비교 요약
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('📊 비교 요약');
  console.log('='.repeat(70));
  console.log(`
┌──────────────────┬─────────────┬──────────────┬──────────────────┐
│ 방법             │ 상품 수     │ LLM 필요     │ 정확도           │
├──────────────────┼─────────────┼──────────────┼──────────────────┤
│ JSON-LD          │ ${String(jsonLdResult.productCount).padStart(9)}개 │ ❌ 불필요    │ ✅ 100% 정확     │
│ XPath            │ ${String(xpathResult.productCount).padStart(9)}개 │ ✅ 필요      │ ⚠️  사이트 의존   │
└──────────────────┴─────────────┴──────────────┴──────────────────┘

💡 권장: JSON-LD 있으면 우선 사용, 없으면 XPath fallback
`);
}

main().catch(console.error);
