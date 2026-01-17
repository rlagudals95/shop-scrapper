import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { BrowserModule } from './browser/browser.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [ConfigModule, DatabaseModule, BrowserModule, AiModule],
  exports: [ConfigModule, DatabaseModule, BrowserModule, AiModule],
})
export class InfrastructureModule {}
