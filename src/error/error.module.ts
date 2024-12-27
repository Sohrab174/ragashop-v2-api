import { DynamicModule, Global, Module } from '@nestjs/common';
import { ErrorService } from './error.service';

@Global()
@Module({})
export class ErrorModule {
  static register(): DynamicModule {
    return {
      module: ErrorModule,
      providers: [ErrorService],
      exports: [ErrorService],
    };
  }
}
