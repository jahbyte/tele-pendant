import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegisterMap } from '../registers/entities/register-map.entity';
import { TrendSample } from './entities/trend-sample.entity';
import { TrendsController } from './trends.controller';
import { TrendsService } from './providers/trends.service';

@Module({
  imports: [TypeOrmModule.forFeature([TrendSample, RegisterMap])],
  controllers: [TrendsController],
  providers: [TrendsService],
  exports: [TrendsService],
})
export class TrendsModule {}
