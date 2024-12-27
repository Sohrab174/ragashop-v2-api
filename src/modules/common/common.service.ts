import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
import { optimizeImage } from '../../utils/sharp';
import { ErrorService } from '../../error/error.service';

@Injectable()
export class CommonService {
  constructor(
    private config: ConfigurationService,
    private error: ErrorService,
  ) {}

  absoluteStaticUrl(path) {
    if (!path) return null;
    return `${this.config.app.apiBaseUrl}/static/${path}`;
  }

  async ckeditorUploader(file: Express.Multer.File) {
    await optimizeImage(file.path);
    return `/ckeditor/${file.filename}`;
  }

  /**
   * -------------------------------------------------------
   */
  async generateManifest(token: string) {
    if (!token) {
      this.error.internalServerError(['Invalid request!']);
    }

    // const logoPath = this.absoluteStaticUrl(`/companies/${company.code}`);
    return {
      name: 'Raga Shop',
      short_name: 'RagaShop',
      display: 'standalone',
      scope: '/',
      start_url: '/',
      orientation: 'portrait',
      theme_color: '#000000',
      background_color: '#ffffff',
      icons: [
        {
          src: `raga.android-chrome-192x192.png`,
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: `raga.android-chrome-512x512.png`,
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    };
  }
}
