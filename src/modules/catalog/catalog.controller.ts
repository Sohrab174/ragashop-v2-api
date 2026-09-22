import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { SearchService } from '../search/search.service';
import { parseStorefrontSearchQuery } from '../search/storefront-search.query';
import { parseStorefrontSuggestionQuery } from '../search/storefront-suggestion.query';
import { CatalogService } from './catalog.service';
import { parseStorefrontPlpQuery } from './storefront-plp.query';

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly searchService: SearchService,
  ) {}

  /**
   * GET /catalog/navigation
   * Customer-facing RagaShop canonical catalog tree.
   * Distinct from GET /categories/tree (source/import taxonomy).
   */
  @Get('navigation')
  async getNavigation() {
    const tree = await this.catalogService.getStorefrontNavigation();
    return successfulResult([], tree);
  }

  /**
   * GET /catalog/search/suggestions
   * Lightweight autocomplete for the Universal Search Bar (Search UX V1.1).
   * Brand/category first; product titles only for longer prefixes.
   */
  @Get('search/suggestions')
  async searchSuggestions(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = parseStorefrontSuggestionQuery({ q, limit });
    if (parsed.ok === false) {
      throw new BadRequestException(parsed.error.message);
    }
    const data = await this.searchService.getSuggestions(parsed.value);
    return successfulResult([], data);
  }

  /**
   * GET /catalog/search
   * Search Engine V1 — keyword catalog search over A4-discoverable products.
   * Does NOT live-query retailers. Paste-a-Link remains a separate path.
   *
   * Query:
   *   q          — required search text (max 120)
   *   page/limit — same bounds as PLP
   *   sort       — relevance (default) | newest | price_asc | price_desc | discount | default
   *   categoryId — optional canonical category scope
   *   brands / minPrice / maxPrice / attrs — same filter grammar as PLP
   */
  @Get('search')
  async searchProducts(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brands') brands?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('attrs') attrs?: string,
  ) {
    const parsed = parseStorefrontSearchQuery({
      q,
      page,
      limit,
      sort,
      categoryId,
      brands,
      minPrice,
      maxPrice,
      attrs,
    });
    if (parsed.ok === false) {
      throw new BadRequestException(parsed.error.message);
    }
    const data = await this.searchService.searchCatalog(parsed.value);
    return successfulResult([], data);
  }

  /**
   * GET /catalog/products
   * Canonical-aware Product Listing + dynamic facets (PLP-2).
   *
   * Query:
   *   categoryId — CANONICAL category id (required)
   *   page       — 1-based (default 1)
   *   limit      — default 24, max 48
   *   sort       — default | newest | price_asc | price_desc | discount
   *   brands     — comma-separated Brand ids (OR within)
   *   minPrice   — toman (inclusive), customer-facing
   *   maxPrice   — toman (inclusive), customer-facing
   *   attrs      — attributeId:valueId,valueId;attributeId:valueId
   *                (OR within attribute, AND across attributes)
   *
   * Price filter uses the same effective-price SQL as sort/display.
   * Filtering converts toman → TRY via tryToToman (inverse of display).
   * Facets are scoped to the same eligible Product population.
   */
  @Get('products')
  async getProducts(
    @Query('categoryId') categoryId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('brands') brands?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('attrs') attrs?: string,
  ) {
    const parsed = parseStorefrontPlpQuery({
      categoryId,
      page,
      limit,
      sort,
      brands,
      minPrice,
      maxPrice,
      attrs,
    });
    if (parsed.ok === false) {
      throw new BadRequestException(parsed.error.message);
    }

    const data = await this.catalogService.getStorefrontProducts(parsed.value);
    return successfulResult([], data);
  }

  /**
   * GET /catalog/products/:id
   * Storefront Product Detail (PDP-1) — source-agnostic public contract.
   * Visibility matches PLP core eligibility (by product id, no facet cost).
   */
  @Get('products/:id')
  async getProduct(@Param('id') id?: string) {
    const productId = Number(id);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new BadRequestException('شناسه محصول نامعتبر است.');
    }

    const data = await this.catalogService.getStorefrontProductDetail(
      productId,
    );
    return successfulResult([], data);
  }
}
