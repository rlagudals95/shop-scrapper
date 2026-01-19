/**
 * 추출 결과를 JSON 파일로 저장하는 스크립트
 *
 * 실행: npx ts-node -r tsconfig-paths/register scripts/export-extraction.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtractorService } from '../src/domain/services/extractor.service';
import { HtmlFilterService } from '../src/domain/services/html-filter.service';
import { PageType, isListingData, ListingProduct } from '../src/domain/entities';

const extractorService = new ExtractorService();
const htmlFilterService = new HtmlFilterService();

const FIXTURES_PATH = path.join(__dirname, '../test/fixtures');
const OUTPUT_PATH = path.join(__dirname, '../data/extracted');

interface StoreConfig {
  name: string;
  listingHtmlPath: string;
  xpathFallback?: {
    productCard: string;
    name: string;
    price: string;
    url: string;
    thumbnail: string;
  };
}

const STORES: StoreConfig[] = [
  {
    name: 'coupang',
    listingHtmlPath: path.join(FIXTURES_PATH, 'coupang/html/list.html'),
    xpathFallback: {
      productCard: "//li[contains(@class, 'ProductUnit_productUnit')]",
      name: ".//div[contains(@class, 'ProductUnit_productNameV2')]",
      price: ".//div[contains(@class, 'PriceArea_priceArea')]//div[contains(@class, 'fw-font-bold')]",
      url: ".//a/@href",
      thumbnail: ".//figure//img/@src",
    },
  },
  {
    name: 'naver',
    listingHtmlPath: path.join(FIXTURES_PATH, 'naver/html/list.html'),
    xpathFallback: {
      productCard: "//li[contains(@class, 'product_item')]",
      name: ".//a[contains(@class, 'product_link')]",
      price: ".//span[contains(@class, 'price_num')]",
      url: ".//a[contains(@class, 'product_link')]/@href",
      thumbnail: ".//img/@src",
    },
  },
];

interface ExportResult {
  store: string;
  extractedAt: string;
  source: 'json-ld' | 'xpath';
  totalProducts: number;
  products: ListingProduct[];
  metadata: {
    htmlSize: number;
    filteredSize: number;
    compressionRatio: number;
    hasJsonLd: boolean;
  };
}

async function exportStore(store: StoreConfig): Promise<ExportResult | null> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${store.name}`);
  console.log('='.repeat(60));

  if (!fs.existsSync(store.listingHtmlPath)) {
    console.log(`  HTML 파일 없음: ${store.listingHtmlPath}`);
    return null;
  }

  const rawHtml = fs.readFileSync(store.listingHtmlPath, 'utf-8');
  console.log(`  HTML 크기: ${(rawHtml.length / 1024).toFixed(1)} KB`);

  const filtered = htmlFilterService.filterForListing(rawHtml);
  console.log(`  필터링 후: ${(filtered.filteredLength / 1024).toFixed(1)} KB (${filtered.compressionRatio}% 압축)`);

  // 1. JSON-LD 우선 추출
  const result = extractorService.extractWithFallback(
    rawHtml,
    store.xpathFallback || null,
    PageType.LISTING,
  );

  console.log(`  추출 소스: ${result.source}`);
  console.log(`  상품 수: ${result.productCount}`);

  if (!isListingData(result.data)) {
    console.log('  ListingData 아님');
    return null;
  }

  const exportData: ExportResult = {
    store: store.name,
    extractedAt: new Date().toISOString(),
    source: result.source,
    totalProducts: result.productCount,
    products: result.data.products,
    metadata: {
      htmlSize: rawHtml.length,
      filteredSize: filtered.filteredLength,
      compressionRatio: filtered.compressionRatio,
      hasJsonLd: !!filtered.jsonLd,
    },
  };

  return exportData;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Commerce Crawler - 추출 결과 JSON 내보내기');
  console.log('='.repeat(60));

  // 출력 디렉토리 생성
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.mkdirSync(OUTPUT_PATH, { recursive: true });
    console.log(`출력 디렉토리 생성: ${OUTPUT_PATH}`);
  }

  const results: ExportResult[] = [];

  for (const store of STORES) {
    const result = await exportStore(store);
    if (result) {
      results.push(result);

      // 개별 스토어 파일 저장
      const filePath = path.join(OUTPUT_PATH, `${store.name}-listing.json`);
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`  저장됨: ${filePath}`);
    }
  }

  // 전체 요약 파일 저장
  const summaryPath = path.join(OUTPUT_PATH, 'summary.json');
  const summary = {
    exportedAt: new Date().toISOString(),
    stores: results.map((r) => ({
      name: r.store,
      source: r.source,
      productCount: r.totalProducts,
      hasJsonLd: r.metadata.hasJsonLd,
    })),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n요약 저장됨: ${summaryPath}`);

  // 결과 출력
  console.log('\n' + '='.repeat(60));
  console.log('내보내기 완료');
  console.log('='.repeat(60));
  console.log(`\n총 ${results.length}개 스토어 처리됨:\n`);

  results.forEach((r) => {
    console.log(`  ${r.store}:`);
    console.log(`    - 소스: ${r.source}`);
    console.log(`    - 상품 수: ${r.totalProducts}`);
    console.log(`    - JSON-LD: ${r.metadata.hasJsonLd ? 'O' : 'X'}`);
    if (r.products.length > 0) {
      console.log(`    - 첫 상품: ${r.products[0].name.substring(0, 40)}...`);
    }
  });

  console.log(`\n파일 위치: ${OUTPUT_PATH}/`);
}

main().catch(console.error);
