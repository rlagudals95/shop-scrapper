import { Module } from '@nestjs/common';
import { CrawlerService } from './services/crawler.service';
import { DomainModule } from '@/domain/domain.module';
import { InfrastructureModule } from '@/infrastructure/infrastructure.module';

@Module({
  imports: [DomainModule, InfrastructureModule],
  providers: [CrawlerService],
  exports: [CrawlerService],
})
export class ApplicationModule {}
