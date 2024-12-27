import { Injectable } from '@nestjs/common';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  private config;

  constructor() {
    const env = process.env;

    this.config = {
      type: env.DATABASE_TYPE || 'mysql',
      host: env.DATABASE_HOST || 'localhost',
      port: parseInt(env.DATABASE_PORT, 10) || 3306,
      password: env.DATABASE_PASSWORD,
      name: env.DATABASE_NAME,
      username: env.DATABASE_USERNAME,
      logging: env.NODE_ENV === 'development',
      synchronize: false,
    };
  }

  createTypeOrmOptions(): TypeOrmModuleOptions {
    return {
      type: this.config.type,
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      database: this.config.name,
      synchronize: this.config.synchronize,
      keepConnectionAlive: true,
      logging: this.config.logging,
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      subscribers: [__dirname + '/../**/*.subscriber{.ts,.js}'],
      migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
      seeds: [__dirname + '/seeds/**/*{.ts,.js}'],
      factories: [__dirname + '/factories/**/*{.ts,.js}'],
      cli: {
        entitiesDir: 'src',
        migrationsDir: 'src/database/migrations',
        subscribersDir: 'subscriber',
      },
    } as TypeOrmModuleOptions;
  }
}
