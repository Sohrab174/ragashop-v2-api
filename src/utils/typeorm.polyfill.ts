import { SelectQueryBuilder } from 'typeorm';
import { VIRTUAL_COLUMN_KEY } from './decorators/virtual-column.decorator';

declare module 'typeorm' {
  interface SelectQueryBuilder<Entity> {
    getMany(this: SelectQueryBuilder<Entity>): Promise<Entity[] | undefined>;
    getOne(this: SelectQueryBuilder<Entity>): Promise<Entity | undefined>;
  }
}

SelectQueryBuilder.prototype.getMany = async function () {
  const { entities, raw } = await this.getRawAndEntities();

  const items = entities.map((entitiy, index) => {
    const metaInfo = Reflect.getMetadata(VIRTUAL_COLUMN_KEY, entitiy) ?? {};
    const item = raw[index];

    for (const [propertyKey, propertyOptions] of Object.entries<any>(
      metaInfo,
    )) {
      const { name, options } = propertyOptions;
      let value = item[name];
      if (options?.transformer) {
        value = options.transformer.from(value);
      }
      entitiy[propertyKey] = value;
    }

    return entitiy;
  });

  return [...items];
};

SelectQueryBuilder.prototype.getOne = async function () {
  const { entities, raw } = await this.getRawAndEntities();

  let metaInfo = {};
  if (entities.length > 0) {
    metaInfo = Reflect.getMetadata(VIRTUAL_COLUMN_KEY, entities[0]) ?? {};
  }

  for (const [propertyKey, propertyOptions] of Object.entries<any>(metaInfo)) {
    const { name, options } = propertyOptions;
    let value = raw[0][name];
    if (options?.transformer) {
      value = options.transformer.from(value);
    }
    entities[0][propertyKey] = value;
  }

  return entities[0];
};

SelectQueryBuilder.prototype.getManyAndCount = async function () {
  const number = await this.getCount();
  const { entities, raw } = await this.getRawAndEntities();

  const items = entities.map((entitiy, index) => {
    const metaInfo = Reflect.getMetadata(VIRTUAL_COLUMN_KEY, entitiy) ?? {};
    const item = raw[index];

    for (const [propertyKey, propertyOptions] of Object.entries<any>(
      metaInfo,
    )) {
      const { name, options } = propertyOptions;
      let value = item[name];
      if (options?.transformer) {
        value = options.transformer.from(value);
      }
      entitiy[propertyKey] = value;
    }

    return entitiy;
  });

  return [[...items], number];
};
