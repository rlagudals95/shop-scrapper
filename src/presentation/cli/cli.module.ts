import { Module } from '@nestjs/common';
import { CrawlCommand } from './commands/crawl.command';
import { ListCommand } from './commands/list.command';
import { CacheCommand } from './commands/cache.command';
import { ApplicationModule } from '@/application/application.module';
import { InfrastructureModule } from '@/infrastructure/infrastructure.module';

@Module({
  imports: [ApplicationModule, InfrastructureModule],
  providers: [CrawlCommand, ListCommand, CacheCommand],
})
export class CliModule {}
