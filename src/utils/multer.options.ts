import { HttpException, HttpStatus } from '@nestjs/common';
import { diskStorage } from 'multer';
import { v4 as uuid } from 'uuid';
import * as path from 'path';

import * as dotenv from 'dotenv';
import { convertMimeToExt } from './extension';
dotenv.config();

export const multerOptions = (
  customPath = null,
  customMimeTypes = ['jpg', 'jpeg', 'png', 'webp'],
  customeFileSize = null, // 1 MB
) => ({
  limits: {
    fileSize:
      customeFileSize || process.env.MAX_PHOTO_FILE_SIZE || 1024 * 1024 * 1,
  },
  fileFilter: (req, file, callback) => {
    if (customMimeTypes.indexOf(convertMimeToExt(file.mimetype)) !== -1) {
      // Allow storage of file
      callback(null, true);
    } else {
      // Reject file
      callback(
        new HttpException(
          `t.It is not possible to upload a file with ${path
            .extname(file.originalname)
            .replace('.', '')
            .toUpperCase()} format!`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
        false,
      );
    }
  },
  storage: diskStorage({
    destination: `./uploads${customPath ? `/${customPath}` : ''}`,
    filename: (req, file, callback) => {
      if (customPath === 'companies') {
        const companyName = req.body.code;

        let fileName = file.fieldname;

        if (file.fieldname === 'logoFull') {
          fileName = 'logo-full';
        } else if (file.fieldname === 'androidChrome512') {
          fileName = 'android-chrome-512x512';
        } else if (file.fieldname === 'androidChrome192') {
          fileName = 'android-chrome-192x192';
        } else if (file.fieldname === 'appleTouchIcon') {
          fileName = 'apple-touch-icon';
        } else if (file.fieldname === 'favicon16') {
          fileName = 'favicon-16x16';
        } else if (file.fieldname === 'favicon32') {
          fileName = 'favicon-32x32';
        }

        callback(
          null,
          `${companyName}.${fileName}${path.extname(file.originalname)}`,
        );
      } else {
        //Calling the callback passing the random name generated with the original extension name
        callback(null, `${uuid()}${path.extname(file.originalname)}`);
      }
    },
  }),
});
