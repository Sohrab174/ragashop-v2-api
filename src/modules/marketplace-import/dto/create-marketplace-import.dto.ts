import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateMarketplaceImportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @IsUrl(
    {
      protocols: ['https'],
      require_protocol: true,
    },
    { message: 'لینک وارد شده معتبر نیست.' },
  )
  url: string;
}
