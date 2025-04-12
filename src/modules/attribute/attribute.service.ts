import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AttributeEntity } from './entities/attribute.entity';
import { Repository } from 'typeorm';
import { getConnection } from 'typeorm/globals';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { AttributeValueEntity } from './entities/attribute-value.entity';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto';
import { UpdateAttributeValueDto } from './dto/update-attribute-value.dto';
import { TranslatorService } from '../../thirdParty/translator/translator.service';

@Injectable()
export class AttributeService {
  constructor(
    @InjectRepository(AttributeEntity)
    private attributeRepository: Repository<AttributeEntity>,

    @InjectRepository(AttributeValueEntity)
    private attributeValueRepository: Repository<AttributeValueEntity>,

    private error: ErrorService,
    private translatorService: TranslatorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /attributes/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.attributeRepository
      .createQueryBuilder('attribute')
      .leftJoinAndSelect('attribute.values', 'values')
      .where({ id });

    const attribute = await builder.getOne();

    if (!attribute) {
      this.error.unprocessableEntity(['ویژگی پیدا نشد!']);
    }

    return attribute;
  }

  /**
   * -------------------------------------------------------
   * GET /attributes/values/admin
   */
  async getAllValuesForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
  ) {
    let builder = this.attributeValueRepository.createQueryBuilder('value');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('value.id', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /attributes/admin
   */
  async getAllForAdmin(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.attributeRepository
      .createQueryBuilder('attribute')

      .leftJoinAndSelect('attribute.values', 'values');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('attribute.id', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * POST /attributes/value/admin
   */
  async addValue(dto: CreateAttributeValueDto) {
    const existAttribute = await this.attributeRepository.findOne({
      id: dto.attributeId,
    });
    if (!existAttribute) {
      this.error.unprocessableEntity(['ویژگی پیدا نشد!']);
    }

    // Creating a new attribute value
    const { identifiers } = await this.attributeValueRepository
      .createQueryBuilder()
      .insert()
      .values({
        attributeId: dto.attributeId,
        extraValue: dto.extraValue,
      })
      .execute();

    const newValueId = identifiers[0].id;

    return { id: newValueId };
  }

  /**
   * -------------------------------------------------------
   * POST /attributes/admin
   */
  async add(dto: CreateAttributeDto) {
    // Creating a new attribute
    const { identifiers } = await this.attributeRepository
      .createQueryBuilder()
      .insert()
      .values({
        type: dto.type,
      })
      .execute();

    const newAttributeId = identifiers[0].id;

    return { id: newAttributeId };
  }

  /**
   * -------------------------------------------------------
   * PUT /attributes/value/admin
   */
  async updateValue(dto: UpdateAttributeValueDto) {
    const attributeValue = await this.attributeValueRepository.findOne({
      where: { id: dto.id },
    });

    if (!attributeValue) {
      this.error.unprocessableEntity(['مقدار مشخصه پیدا نشد']);
    }

    // Updating the attribute value
    attributeValue.extraValue = dto.extraValue;

    await attributeValue.save();

    // Updating the exist attribute value locales and Inserting a new attribute value locales
    // for (let i = 0; i < do.locales?.length; i++) {
    //   const locale = dto.locales[i];

    //   // const oldLocale = attributeValue.locales.find(
    //   //   (old) => old.language === locale.language,
    //   // );

    //   // Updating
    //   // if (oldLocale) {
    //   //   oldLocale.value = locale.value;
    //   //   await oldLocale.save();
    //   // }

    //   // Inserting
    //   //   else {
    //   //     await this._insertValueLocales([locale], attributeValue.id);
    //   //   }
    // }t

    return true;
  }

  /**
   * -------------------------------------------------------
   * PUT /attributes/admin
   */
  async update(dto: UpdateAttributeDto) {
    const attribute = await this.attributeRepository.findOne({
      where: { id: dto.id },
    });

    if (!attribute) {
      this.error.unprocessableEntity(['ویژگی پیدا نشد!']);
    }

    // Updating the attribute
    // attribute.type = dto.type;
    await attribute.save();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /attributes/:id/admin
   */
  async delete(id: number) {
    const attribute = await this.attributeRepository.findOne({
      where: { id },
    });

    if (!attribute) {
      this.error.unprocessableEntity(['ویژگی پیدا نشد!']);
    }

    // Rollbacking the attribute locales if an error occurs
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Removing the attribute
      await queryRunner.manager.remove(attribute);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();

      this.error.methodNotAllowed([
        'برخی از مقادیر مربوط به این ویژگی هستند، لطفاً ابتدا مقادیر این ویژگی را حذف کنید',
      ]);
    } finally {
      await queryRunner.release();
    }

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /attributes/value/:id/admin
   */
  async deleteValue(id: number) {
    const attributeValue = await this.attributeValueRepository.findOne({
      where: { id },
    });

    if (!attributeValue) {
      this.error.unprocessableEntity(['مقدار مشخصه پیدا نشد']);
    }

    // Rollbacking the attribute locales if an error occurs
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Removing the attribute value
      await queryRunner.manager.remove(attributeValue);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();

      this.error.methodNotAllowed([
        'برخی از محصولات مربوط به این ویژگی  هستند، لطفاً ابتدا محصولات این ویژگی را حذف کنید',
      ]);
    } finally {
      await queryRunner.release();
    }

    return true;
  }

  /**
   * -------------------------------------------------------
   */
  async getRecordById(attributeValueId) {
    return await this.attributeValueRepository.findOne({
      id: attributeValueId,
    });
  }

  /**
   * -------------------------------------------------------
   */
  async getRecordByName(attributeName, attributeValue) {
    const attribute = await this.attributeRepository
      .createQueryBuilder('attribute')

      .getOne();

    if (!attribute) {
      return null;
    }

    const attrValue = await this.attributeValueRepository
      .createQueryBuilder('attributeValue')
      .andWhere({ attributeId: attribute.id })

      .getOne();

    if (attrValue) {
      return attrValue.id;
    }

    //insert to attribute value
    const { identifiers } = await this.attributeValueRepository
      .createQueryBuilder()
      .insert()
      .values({
        attributeId: attribute.id,
      })
      .execute();

    const newAttrValueId = identifiers[0].id;

    // await this._insertValueLocales(
    //   [{ language: lang, value: attributeValue }],
    //   newAttrValueId,
    // );

    return newAttrValueId;
  }

  /**
   * -------------------------------------------------------
   */
  async addOrUpdates(attributes, source) {
    const attributeValues = [];

    for (const attribute of attributes) {
      let foundAttribute = await this.attributeRepository.findOne({
        source,
        sourceId: attribute.id,
      });

      let foundAttributeValue = null;
      if (!foundAttribute) {
        foundAttribute = this.attributeRepository.create({
          source,
          sourceId: attribute.id,
          sourceName: attribute.name.slice(0, 128),
          name: (await this._findOrTranslateAttr(attribute.name)).slice(0, 128),
        });
        await this.attributeRepository.save(foundAttribute);
      } else {
        foundAttributeValue = await this.attributeValueRepository.findOne({
          where: [
            attribute.value.id
              ? {
                  source,
                  sourceId: attribute.value.id,
                  attributeId: foundAttribute.id,
                }
              : {
                  source,
                  sourceName: attribute.value.name,
                  attributeId: foundAttribute.id,
                },
          ],
        });
      }

      if (!foundAttributeValue) {
        foundAttributeValue = this.attributeValueRepository.create({
          attributeId: foundAttribute.id,
          source,
          sourceId: attribute.value.id,
          sourceName: attribute.value.name.slice(0, 128),
          name: (
            await this._findOrTranslateAttrValue(attribute.value.name)
          ).slice(0, 128),
        });
        await this.attributeValueRepository.save(foundAttributeValue);
      }

      attributeValues.push({
        valueId: foundAttributeValue.id,
        ...attribute.value,
      });
    }

    return attributeValues;
  }

  /**
   * -------------------------------------------------------
   */
  private async _findOrTranslateAttr(sourceName) {
    const exist = await this.attributeRepository
      .createQueryBuilder('attr')
      .select(['attr.id', 'attr.name'])
      .where('attr.sourceName = :sourceName', { sourceName })
      .andWhere('attr.name REGEXP :persianPattern', {
        persianPattern: '[\\u0600-\\u06FF]',
      })
      .getOne();

    if (exist) {
      return exist.name;
    }

    return (await this.translatorService.text(sourceName)) || sourceName;
  }

  /**
   * -------------------------------------------------------
   */
  private async _findOrTranslateAttrValue(sourceName) {
    const exist = await this.attributeValueRepository
      .createQueryBuilder('attrValue')
      .select(['attrValue.id', 'attrValue.name'])
      .where('attrValue.sourceName = :sourceName', { sourceName })
      .andWhere('attrValue.name REGEXP :persianPattern', {
        persianPattern: '[\\u0600-\\u06FF]',
      })
      .getOne();

    if (exist) {
      return exist.name;
    }

    return (await this.translatorService.text(sourceName)) || sourceName;
  }
}
