import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigurationService } from './configuration.service';

@Global()
@Module({})
export class ConfigurationModule {
  static register(): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [ConfigurationService],
      exports: [ConfigurationService],
    };
  }
}
