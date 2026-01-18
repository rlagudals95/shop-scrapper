import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  XPathCacheOrmEntity,
  CrawlSessionOrmEntity,
  ListingProductOrmEntity,
} from './entities';
import { XPathCacheRepository } from './repositories/xpath-cache.repository';
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
            XPathCacheOrmEntity,
            CrawlSessionOrmEntity,
            ListingProductOrmEntity,
          ],
          synchronize: true,
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([
      XPathCacheOrmEntity,
      CrawlSessionOrmEntity,
      ListingProductOrmEntity,
    ]),
  ],
  providers: [
    XPathCacheRepository,
    CrawlResultRepository,
    {
      provide: INJECTION_TOKENS.XPATH_REPOSITORY,
      useExisting: XPathCacheRepository,
    },
  ],
  exports: [
    INJECTION_TOKENS.XPATH_REPOSITORY,
    XPathCacheRepository,
    CrawlResultRepository,
  ],
})
export class DatabaseModule {}
