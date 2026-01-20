import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import { Inject } from '@nestjs/common';
import { ISelectorRepository } from '@/domain/interfaces';
import { INJECTION_TOKENS } from '@/common';

interface CacheCommandOptions {
  list?: boolean;
  clear?: boolean;
  clearAll?: boolean;
  site?: string;
}

@Command({
  name: 'cache',
  description: 'Manage selector cache',
})
export class CacheCommand extends CommandRunner {
  constructor(
    @Inject(INJECTION_TOKENS.SELECTOR_REPOSITORY)
    private readonly selectorRepository: ISelectorRepository,
  ) {
    super();
  }

  async run(inputs: string[], options: CacheCommandOptions): Promise<void> {
    if (options.list) {
      await this.listCache();
    } else if (options.clearAll) {
      await this.clearAllCache();
    } else if (options.clear && options.site) {
      await this.clearSiteCache(options.site);
    } else {
      console.log('Usage:');
      console.log('  cache --list                    List all cached selectors');
      console.log('  cache --clear --site <domain>   Clear cache for a specific site');
      console.log('  cache --clear-all               Clear all cached selectors');
    }
  }

  @Option({
    flags: '--list',
    description: 'List all cached selectors',
  })
  parseList(): boolean {
    return true;
  }

  @Option({
    flags: '--clear',
    description: 'Clear cache (requires --site)',
  })
  parseClear(): boolean {
    return true;
  }

  @Option({
    flags: '--clear-all',
    description: 'Clear all cached selectors',
  })
  parseClearAll(): boolean {
    return true;
  }

  @Option({
    flags: '--site <domain>',
    description: 'Target site domain',
  })
  parseSite(val: string): string {
    return val;
  }

  private async listCache(): Promise<void> {
    const caches = await this.selectorRepository.findAll();

    if (caches.length === 0) {
      console.log('No cached selectors found.');
      return;
    }

    console.log('\n--- Cached Selectors ---\n');
    for (const cache of caches) {
      console.log(`Domain: ${cache.siteDomain}`);
      console.log(`Page Type: ${cache.pageType}`);
      console.log(`Updated: ${cache.updatedAt?.toISOString() || 'N/A'}`);
      console.log('Selectors:');
      for (const [field, selector] of Object.entries(cache.selectors)) {
        console.log(`  ${field}: ${selector}`);
      }
      console.log('');
    }
  }

  private async clearSiteCache(site: string): Promise<void> {
    await this.selectorRepository.invalidate(site);
    console.log(`Cache cleared for: ${site}`);
  }

  private async clearAllCache(): Promise<void> {
    await this.selectorRepository.clearAll();
    console.log('All cache cleared.');
  }
}
