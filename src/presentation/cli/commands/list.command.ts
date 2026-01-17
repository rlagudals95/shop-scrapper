import { Command, CommandRunner, Option } from 'nest-commander';
import { CrawlerService } from '@/application/services';
import { ListingData, isListingData } from '@/domain/entities';
import { createLogger } from '@/common';

interface ListCommandOptions {
  json?: boolean;
  limit?: number;
}

@Command({
  name: 'list',
  description: 'Crawl a listing page and extract product URLs',
  arguments: '<url>',
})
export class ListCommand extends CommandRunner {
  private readonly logger = createLogger(ListCommand.name);

  constructor(private readonly crawlerService: CrawlerService) {
    super();
  }

  async run(inputs: string[], options: ListCommandOptions): Promise<void> {
    const url = inputs[0];

    if (!url) {
      console.error('Error: URL is required');
      process.exit(1);
    }

    try {
      const result = await this.crawlerService.crawlListing(url);

      if (!result.success || !result.data) {
        console.error(`Error: ${result.error || 'Failed to extract listing data'}`);
        process.exit(1);
      }

      if (!isListingData(result.data)) {
        console.error('Error: Unexpected data format');
        process.exit(1);
      }

      const listingData = result.data as ListingData;
      let products = listingData.products;

      if (options.limit && options.limit > 0) {
        products = products.slice(0, options.limit);
      }

      if (options.json) {
        console.log(JSON.stringify({ products, total: listingData.products.length }, null, 2));
      } else {
        console.log(`\nFound ${listingData.products.length} products\n`);
        products.forEach((product, index) => {
          console.log(`${index + 1}. ${product.name}`);
          console.log(`   Price: ${product.price}`);
          console.log(`   URL: ${product.url}`);
          if (product.thumbnail) {
            console.log(`   Thumbnail: ${product.thumbnail}`);
          }
          console.log('');
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  }

  @Option({
    flags: '-j, --json',
    description: 'Output result as JSON',
  })
  parseJson(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit <number>',
    description: 'Limit the number of products to display',
  })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }
}
