import { Command, CommandRunner, Option } from 'nest-commander';
import { CrawlerService } from '@/application/services';
import { PageType } from '@/domain/entities';
import { createLogger } from '@/common';

interface CrawlCommandOptions {
  type?: 'listing' | 'pdp';
  force?: boolean;
  json?: boolean;
}

@Command({
  name: 'crawl',
  description: 'Crawl a URL and extract product data',
  arguments: '<url>',
})
export class CrawlCommand extends CommandRunner {
  private readonly logger = createLogger(CrawlCommand.name);

  constructor(private readonly crawlerService: CrawlerService) {
    super();
  }

  async run(inputs: string[], options: CrawlCommandOptions): Promise<void> {
    const url = inputs[0];

    if (!url) {
      console.error('Error: URL is required');
      process.exit(1);
    }

    try {
      const pageType = this.parsePageType(options.type);
      const result = await this.crawlerService.crawl({
        url,
        pageType,
        forceReanalyze: options.force,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        this.printResult(result);
      }

      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  }

  @Option({
    flags: '-t, --type <type>',
    description: 'Page type: listing or pdp',
  })
  parseType(val: string): string {
    return val;
  }

  @Option({
    flags: '-f, --force',
    description: 'Force re-analysis even if cache exists',
  })
  parseForce(): boolean {
    return true;
  }

  @Option({
    flags: '-j, --json',
    description: 'Output result as JSON',
  })
  parseJson(): boolean {
    return true;
  }

  private parsePageType(type?: string): PageType | undefined {
    if (!type) return undefined;
    if (type === 'listing') return PageType.LISTING;
    if (type === 'pdp') return PageType.PDP;
    return undefined;
  }

  private printResult(result: {
    success: boolean;
    url: string;
    domain: string;
    pageType?: PageType;
    data?: unknown;
    error?: string;
    retryCount: number;
    cached: boolean;
  }): void {
    console.log('\n--- Crawl Result ---');
    console.log(`URL: ${result.url}`);
    console.log(`Domain: ${result.domain}`);
    console.log(`Success: ${result.success}`);
    console.log(`Page Type: ${result.pageType || 'Unknown'}`);
    console.log(`Cached: ${result.cached}`);
    console.log(`Retry Count: ${result.retryCount}`);

    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    if (result.data) {
      console.log('\n--- Extracted Data ---');
      console.log(JSON.stringify(result.data, null, 2));
    }
  }
}
