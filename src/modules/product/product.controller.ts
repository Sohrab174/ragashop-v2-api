import { HttpStatus } from '@nestjs/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common/decorators';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { Filter } from '../../utils/decorators/filter.decorator';
import { Limit } from '../../utils/decorators/limit.decorator';
import { Page } from '../../utils/decorators/page.decorator';
import { Sort } from '../../utils/decorators/sort.decorator';
import { User } from '../../utils/decorators/user.decorator';
import { multerOptions } from '../../utils/multer.options';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserEntity, UserRoles } from '../user/entities/user.entity';
import { CreateProductGalleryDto } from './dto/create-product-gallery.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductGalleryType } from './entities/product-gallery.entity';
import { ProductStatus } from './entities/product.entity';
import { ProductService } from './product.service';
import { ErrorService } from '../../error/error.service';
import { ProductSortDto } from './dto/product-sort.dto';

import * as dotenv from 'dotenv';
import { CreateUpdateProductAttrValueDto } from './dto/create-update-product-attr-value.dto';
import { ProductImportExcelDto } from './dto/product-import-excel.dto';
import { CrawlerService } from '../../thirdParty/crawler/crawler.service';
dotenv.config();

@ApiTags('Product')
@Controller('products')
export class ProductController {
  constructor(
    private productService: ProductService,
    private error: ErrorService,
    private crawlerService: CrawlerService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /products/crawler/admin
   */
  @Post('/crawler/admin')
  // @ApiBearerAuth()
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(UserRoles.admin, UserRoles.employee)
  async crawler() {
    const results = await this.productService.getProductsByCrawler();

    return successfulResult([], results);
  }

  /**
   * -------------------------------------------------------
   * POST /products/import/excel/admin
   */
  @Post('/import/excel/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', multerOptions('temp', ['xlsx', 'xls'])),
  )
  async importExcel(
    @Body() dto: ProductImportExcelDto,
    @UploadedFile() file,
    @User() user: UserEntity,
  ) {
    const results = await this.productService.importExcel(file, dto, user);

    const successCount = results.filter((result) => result.success).length;
    if (successCount === 0) {
      this.error.unprocessableEntity(
        ['t.There was an error importing the products list'],
        results,
      );
    }

    let message = 'Part of the list of products has been successfully imported';
    if (results.length === successCount) {
      message = 'The list of products has been successfully imported';
    }

    return successfulResult([`t.${message}`], results);
  }

  /**
   * -------------------------------------------------------
   * GET /products/allow-file-extensions/admin
   */
  @Get('allow-file-extensions/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async allowFileExtensions() {
    return successfulResult([], process.env.PRODUCT_FILE_TYPES.split(','));
  }

  /**
   * -------------------------------------------------------
   * GET /products/statistic/admin
   */
  @Get('statistic/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async statistic() {
    const data = await this.productService.statistic();
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /products/galleries/admin
   */
  @Get('galleries/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'product_id', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ProductGalleryType })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllGalleries(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['type', ['product_id', 'productId']])
    filters,
  ) {
    const list = await this.productService.getAllGalleries(
      page,
      limit,
      filters,
      sorts,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /products/admin
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'category_id', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'number', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ProductStatus })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAllForAdmin(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter(['status', ['category_id', 'categoryId'], 'name'])
    filters,
    @Query('number') number,
  ) {
    const list = await this.productService.getAllForAdmin(
      page,
      limit,
      filters,
      sorts,
      number,
    );

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /products/with-attributes/admin
   */
  @Get('with-attributes/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getAllForAdminWithAttributes() {
    const list = await this.productService.getAllForAdminWithAttributes();

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id/attributes/admin
   */
  @Get(':id/attributes/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getAttributesByProductId(@Param('id') productId: number) {
    const data = await this.productService.getAttributesByProductId(productId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id/admin
   */
  @Get(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.god, UserRoles.admin, UserRoles.employee)
  async getByIdForAdmin(@Param('id') productId: number) {
    const data = await this.productService.getByIdForAdmin(productId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /products/summary
   */
  @Get('summary')
  @ApiQuery({ name: 'limit_per_category', required: true })
  async getSummaries(@Query('limit_per_category') limitPerCategory) {
    const list = await this.productService.getSummaries(limitPerCategory);

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /products/filter/price
   */
  @Get('/filter/price')
  @ApiQuery({ name: 'category_id', required: false })
  async getMinMaxPricesForFilter(
    @Filter([['category_id', 'categoryId']]) filters,
  ) {
    const data = await this.productService.getMinMaxPricesForFilter(filters);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /products/filter/color
   */
  @Get('/filter/color')
  @ApiQuery({ name: 'category_id', required: false })
  async getColorsFilter(@Filter([['category_id', 'categoryId']]) filters) {
    const list = await this.productService.getColorsFilter(filters);
    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * GET /products/:id
   */
  @Get(':id')
  async getById(@Param('id') productId: number) {
    const data = await this.productService.getById(productId);
    return successfulResult([], data);
  }

  /**
   * -------------------------------------------------------
   * GET /products
   */
  @Get()
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'min_price', required: false })
  @ApiQuery({ name: 'max_price', required: false })
  @ApiQuery({ name: 'category_id', required: false })
  @ApiQuery({ name: 'color', required: false })
  @ApiQuery({ name: 'number', required: false })
  @ApiQuery({ name: 'sort', required: false, description: 'e.g. id:desc' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiQuery({ name: 'page', required: false, description: 'Default: 1' })
  async getAll(
    @Page() page,
    @Limit() limit,
    @Sort() sorts,
    @Filter([
      ['category_id', 'categoryId'],
      ['color', 'attributeValue.extraValue'],
      'name',
      'number',
    ])
    filters,
    @Query('min_price') minPrice,
    @Query('max_price') maxPrice,
  ) {
    const list = await this.productService.getAll(page, limit, filters, sorts, {
      minPrice,
      maxPrice,
    });

    return successfulResult([], list);
  }

  /**
   * -------------------------------------------------------
   * POST /products/photo/admin
   */
  @Post('/photo/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', multerOptions('products')))
  async addGalleryPhoto(
    @Body() dto: CreateProductGalleryDto,
    @UploadedFile() file,
    @User() user: UserEntity,
  ) {
    const filePath = await this.productService.addGallery(
      dto,
      file,
      ProductGalleryType.photo,
      user,
    );

    return successfulResult(
      ['تصویر محصول مورد نظر با موفقیت آپلود شد'],
      filePath,
    );
  }

  /**
   * -------------------------------------------------------
   * POST /products/video/admin
   */
  @Post('/video/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  // @Features(CompanyFeatures.productVideoGallery)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor(
      'file',
      multerOptions(
        'products',
        ['mp4', 'mkv', 'avi', 'wmv'],
        process.env.MAX_VIDEO_FILE_SIZE,
      ),
    ),
  )
  async addGalleryVideo(
    @Body() dto: CreateProductGalleryDto,
    @UploadedFile() file,
    @User() user: UserEntity,
  ) {
    const filePath = await this.productService.addGallery(
      dto,
      file,
      ProductGalleryType.video,
      user,
    );

    return successfulResult(
      ['فایل ویدیو محصول مورد نظر با موفقیت آپلود شد'],
      filePath,
    );
  }

  /**
   * -------------------------------------------------------
   * POST & PUT /products/attribute/admin
   */
  @Post('attribute/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async addUpdateProductAttributeValue(
    @Body() dto: CreateUpdateProductAttrValueDto,
    @User() user: UserEntity,
  ) {
    const data = await this.productService.addUpdateProductAttributeValue(dto);

    return successfulResult(['ویژگی مورد نظر با موفقیت ذخیره شد'], data);
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/attribute/:id/admin
   */
  @Delete('attribute/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async deleteProductAttributeValue(
    @Param('id') productAttrValueId: number,
    @User() user: UserEntity,
  ) {
    await this.productService.deleteProductAttributeValue(
      productAttrValueId,
      user,
    );

    return successfulResult(['مقدار مشخصه محصول موردنظر حذف شد']);
  }

  /**
   * -------------------------------------------------------
   * POST /products/admin
   */
  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateProductDto, @User() user: UserEntity) {
    const newProduct = await this.productService.add(dto, user);

    return successfulResult(['محصول جدید با موفقیت ایجاد شد'], newProduct);
  }

  /**
   * -------------------------------------------------------
   * PUT /products/sort/admin
   */
  @Put('sort/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @ApiQuery({ name: 'category_id', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ProductStatus })
  async sort(
    @Body() dto: ProductSortDto,
    @User() user: UserEntity,
    @Filter(['status', ['category_id', 'categoryId'], 'name'])
    filters,
  ) {
    await this.productService.sort(dto, user, filters);

    return successfulResult(['محصول مورد نظر جا‌به‌جا شد']);
  }

  /**
   * -------------------------------------------------------
   * PUT /products/admin
   */
  @Put('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async update(@Body() dto: UpdateProductDto, @User() user: UserEntity) {
    await this.productService.update(dto, user);

    return successfulResult(['محصول مورد نظر با موفقیت آپدیت شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/gallery/:id/admin
   */
  @Delete('gallery/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async deleteGallery(
    @Param('id') galleryId: number,
    @User() user: UserEntity,
  ) {
    await this.productService.deleteGallery(galleryId, user);

    return successfulResult(['گالری محصول مورد نظر حذف شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /products/:id/admin
   */
  @Delete(':id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  async delete(@Param('id') productId: number, @User() user: UserEntity) {
    await this.productService.delete(productId, user);

    return successfulResult(['محصول مورد نظر حذف شد']);
  }
}
