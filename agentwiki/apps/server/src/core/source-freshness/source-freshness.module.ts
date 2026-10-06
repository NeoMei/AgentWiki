import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { SourceFreshnessService } from './source-freshness.service';

@Module({ imports: [DatabaseModule, AuthorizationModule], providers: [SourceFreshnessService], exports: [SourceFreshnessService] })
export class SourceFreshnessModule {}
