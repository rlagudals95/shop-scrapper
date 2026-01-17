import { Module } from '@nestjs/common';
import { CliModule } from './presentation/cli/cli.module';
import { ApplicationModule } from './application/application.module';
import { DomainModule } from './domain/domain.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';

@Module({
  imports: [InfrastructureModule, DomainModule, ApplicationModule, CliModule],
})
export class AppModule {}
