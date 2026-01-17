import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { XPathCacheOrmEntity } from './entities/xpath-cache.orm-entity';
import { XPathCacheRepository } from './repositories/xpath-cache.repository';
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
          entities: [XPathCacheOrmEntity],
          synchronize: true,
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([XPathCacheOrmEntity]),
  ],
  providers: [
    XPathCacheRepository,
    {
      provide: INJECTION_TOKENS.XPATH_REPOSITORY,
      useExisting: XPathCacheRepository,
    },
  ],
  exports: [INJECTION_TOKENS.XPATH_REPOSITORY, XPathCacheRepository],
})
export class DatabaseModule {}
