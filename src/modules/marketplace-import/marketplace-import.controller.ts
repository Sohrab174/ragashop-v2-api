import {

  Body,

  Controller,

  Get,

  GoneException,

  Headers,

  HttpCode,

  HttpStatus,

  NotFoundException,

  Param,

  ParseIntPipe,

  Post,

  Req,

  Res,

  UsePipes,

  ValidationPipe,

} from '@nestjs/common';

import { ApiTags } from '@nestjs/swagger';

import { Request, Response } from 'express';

import { successfulResult } from '../../utils';

import { CreateMarketplaceImportDto } from './dto/create-marketplace-import.dto';

import { MarketplaceImportService } from './marketplace-import.service';

import { resolveClientIp } from './client-ip.util';



/** Capability header for public import job status. Never accept tokens via query string. */

export const MARKETPLACE_IMPORT_TOKEN_HEADER = 'x-ragashop-import-token';



@ApiTags('Marketplace Import')

@Controller()

export class MarketplaceImportController {

  constructor(

    private readonly marketplaceImportService: MarketplaceImportService,

  ) {}



  @Post('marketplace-imports')

  @UsePipes(

    new ValidationPipe({

      errorHttpStatusCode: 422,

      whitelist: true,

      forbidNonWhitelisted: true,

    }),

  )

  async createImport(

    @Body() dto: CreateMarketplaceImportDto,

    @Req() req: Request,

    @Res({ passthrough: true }) res: Response,

  ) {

    const clientIp = resolveClientIp(req);

    const correlationId =

      (req.headers['x-request-id'] as string | undefined) || undefined;



    const result = await this.marketplaceImportService.importFromUrl(

      dto.url,

      clientIp,

      correlationId,

    );



    if (result.kind === 'product') {

      res.status(HttpStatus.OK);

      return successfulResult([], { id: result.id, name: result.name });

    }



    res.status(HttpStatus.ACCEPTED);

    return successfulResult([], {

      jobId: result.job.jobId,

      accessToken: result.job.accessToken,

      status: result.job.status,

    });

  }



  @Get('marketplace-imports/:jobId')

  @HttpCode(HttpStatus.OK)

  async getImportStatus(

    @Param('jobId', ParseIntPipe) jobId: number,

    @Headers(MARKETPLACE_IMPORT_TOKEN_HEADER) token: string | undefined,

  ) {

    if (!token || token.length < 16) {

      throw new NotFoundException({

        success: false,

        messages: ['دسترسی به وضعیت درخواست مجاز نیست.'],

        data: {},

      });

    }



    const data = await this.marketplaceImportService.getJobStatus(jobId, token);



    return successfulResult([], data);

  }



  /**

   * Legacy mutating GET endpoint — disabled in Phase 1B.

   */

  @Get('products/link')

  legacyGetByLinkDisabled() {

    throw new GoneException({

      success: false,

      messages: [

        'این مسیر دیگر پشتیبانی نمی‌شود. لطفاً از جستجوی محصول در سایت استفاده کنید.',

      ],

      data: {},

    });

  }

}


