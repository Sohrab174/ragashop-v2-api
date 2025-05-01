import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileStorageService {
  private storagePath = path.resolve(__dirname, '..', 'storage.json');

  private defaultData = {
    trendyolCategories: {
      'kadin-x-g1': 1,
      'erkek-x-g2': 1,
      'cocuk-x-g3': 1,
      'ev-ve-mobilya-x-c145704': 1,
      'zuhre-ana-x-b145383': 1,
      'kozmetik-x-c89': 1,
    },
  };

  save(data: any): void {
    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  load(): any {
    if (!fs.existsSync(this.storagePath)) return this.defaultData;

    const fileContent = fs.readFileSync(this.storagePath, 'utf-8');

    try {
      const parsed = JSON.parse(fileContent);
      return {
        ...this.defaultData,
        ...parsed,
      };
    } catch (err) {
      return this.defaultData;
    }
  }
}
