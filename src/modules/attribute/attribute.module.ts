import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeEntity } from './entities/attribute.entity';
import { AttributeController } from './attribute.controller';
import { AttributeService } from './attribute.service';
import { AttributeValueEntity } from './entities/attribute-value.entity';
import { TranslatorModule } from '../../thirdParty/translator/translator.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AttributeEntity, AttributeValueEntity]),
    TranslatorModule,
  ],
  controllers: [AttributeController],
  providers: [AttributeService],
  exports: [AttributeService],
})
export class AttributeModule {}
