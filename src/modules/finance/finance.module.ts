import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialEventEntity } from './entities/financial-event.entity';
import { FinancialEventService } from './financial-event.service';

@Module({
  imports: [TypeOrmModule.forFeature([FinancialEventEntity])],
  providers: [FinancialEventService],
  exports: [FinancialEventService, TypeOrmModule],
})
export class FinanceModule {}
