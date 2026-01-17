import { Module } from '@nestjs/common';
import { ExtractorService } from './services/extractor.service';
import { ValidatorService } from './services/validator.service';
import { AnalyzerService } from './services/analyzer.service';
import { InfrastructureModule } from '@/infrastructure/infrastructure.module';

@Module({
  imports: [InfrastructureModule],
  providers: [ExtractorService, ValidatorService, AnalyzerService],
  exports: [ExtractorService, ValidatorService, AnalyzerService],
})
export class DomainModule {}
