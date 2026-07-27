import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { SearchModule } from '../core/search/search.module';

@Module({
  imports: [DatabaseModule, AuthModule, SearchModule],
  providers: [ReviewService],
  controllers: [ReviewController],
  exports: [ReviewService],
})
export class ReviewModule {}
