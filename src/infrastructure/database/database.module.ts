import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  SelectorCacheOrmEntity,
  CrawlSessionOrmEntity,
  ListingProductOrmEntity,
} from './entities';
import { SelectorCacheRepository } from './repositories/selector-cache.repository';
import { CrawlResultRepository } from './repositories/crawl-result.repository';
import { INJECTION_TOKENS } from '@/common';
import * as path from 'path';
import * as fs from 'fs';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const dbPath = configService.get<string>('databasePath') || './data/crawler.db';
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return {
          type: 'better-sqlite3',
          database: dbPath,
          entities: [
            SelectorCacheOrmEntity,
            CrawlSessionOrmEntity,
            ListingProductOrmEntity,
          ],
          synchronize: true,
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([
      SelectorCacheOrmEntity,
      CrawlSessionOrmEntity,
      ListingProductOrmEntity,
    ]),
  ],
  providers: [
    SelectorCacheRepository,
    CrawlResultRepository,
    {
      provide: INJECTION_TOKENS.SELECTOR_REPOSITORY,
      useExisting: SelectorCacheRepository,
    },
  ],
  exports: [
    INJECTION_TOKENS.SELECTOR_REPOSITORY,
    SelectorCacheRepository,
    CrawlResultRepository,
  ],
})
export class DatabaseModule {}
