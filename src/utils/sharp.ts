import * as fs from 'fs';
import * as path from 'path';
import * as sharp from 'sharp';
import * as icoEndec from 'ico-endec';
sharp.cache(false);

export const optimizeImage = (
  pathFile,
  resize = { width: 800 },
  quality = 70,
) => {
  return new Promise((resolve, reject) => {
    const ext = path.extname(pathFile).toLowerCase();

    const imageProcessor = sharp(pathFile).resize(resize).withMetadata();

    if (ext === '.png') {
      imageProcessor.png({ quality });
    } else {
      imageProcessor.jpeg({ quality });
    }

    imageProcessor.toBuffer((err, buffer) => {
      if (err) return reject(err);
      fs.writeFile(pathFile, buffer, (error) => {
        if (error) return reject(error);
        return resolve(true);
      });
    });
  });
};

export const squareSizeImage = (
  pathFile,
  width = 300,
  height = 300,
  quality = 70,
) => {
  return new Promise((resolve, reject) => {
    const ext = path.extname(pathFile).toLowerCase();

    const imageProcessor = sharp(pathFile)
      .resize(width, height, {
        kernel: sharp.kernel.nearest,
        fit: sharp.fit.cover,
      })
      .withMetadata();

    if (ext === '.png') {
      imageProcessor.png({ quality });
    } else {
      imageProcessor.jpeg({ quality });
    }

    imageProcessor.toBuffer((err, buffer) => {
      if (err) return reject(err);
      fs.writeFile(pathFile, buffer, (error) => {
        if (error) return reject(error);
        return resolve(true);
      });
    });
  });
};

export const generateThumbnail = (
  pathFile,
  width = 300,
  height = 300,
  quality = 70,
) => {
  return new Promise((resolve, reject) => {
    const ext = path.extname(pathFile).toLowerCase();

    const savePath = applyPathToThumbPath(pathFile);

    const imageProcessor = sharp(pathFile)
      .resize(width, height, {
        kernel: sharp.kernel.nearest,
        fit: sharp.fit.cover,
      })
      .withMetadata();

    if (ext === '.png') {
      imageProcessor.png({ quality });
    } else {
      imageProcessor.jpeg({ quality });
    }

    imageProcessor.toFile(savePath, (err, info) => {
      if (err) return reject(err);
      return resolve(info);
    });
  });
};

export const generateOtherSize = (
  pathFile,
  sizeName = 'thumb',
  width = 300,
  height = 300,
  quality = 70,
) => {
  return new Promise((resolve, reject) => {
    const ext = path.extname(pathFile).toLowerCase();

    const savePath = applyPathToDifferentPath(
      pathFile.replace('.logo', ''),
      sizeName,
    );

    if (ext === '.svg') {
      fs.copyFile(pathFile, savePath, (err) => {
        if (err) return reject(err);
        return resolve(true);
      });
    } else {
      const imageProcessor = sharp(pathFile)
        .resize(width, height, {
          kernel: sharp.kernel.nearest,
          fit: sharp.fit.cover,
        })
        .withMetadata();

      if (ext === '.png') {
        imageProcessor.png({ quality });
      } else {
        imageProcessor.jpeg({ quality });
      }

      imageProcessor.toFile(savePath, (err, info) => {
        if (err) return reject(err);
        return resolve(info);
      });
    }
  });
};

export const generateIco = (pathFile) => {
  return new Promise(async (resolve, reject) => {
    const savePath = applyPathToDifferentPath(
      pathFile.replace('.logo', ''),
      'favicon',
      'ico',
    );

    try {
      const buffer = await sharp(pathFile)
        .toFormat('png')
        .resize(48, 48, {
          kernel: sharp.kernel.nearest,
          fit: sharp.fit.cover,
        })
        .toBuffer({ resolveWithObject: true });

      const icoBuffer = icoEndec.encode(buffer.data);

      fs.writeFileSync(savePath, icoBuffer);
      return resolve(true);
    } catch (error) {
      return reject(error);
    }
  });
};

export const applyPathToDifferentPath = (
  pathFile,
  sizeName = 'thumb',
  extention = null,
) => {
  const ext = /(?:\.([^.]+))?$/.exec(pathFile)[1];
  return pathFile.replace(`.${ext}`, `.${sizeName}.${extention || ext}`);
};

export const applyPathToThumbPath = (pathFile) => {
  const ext = /(?:\.([^.]+))?$/.exec(pathFile)[1];
  return pathFile.replace(`.${ext}`, `.thumb.${ext}`);
};

export const getDimension = (pathFile) => {
  return new Promise((resolve, reject) => {
    sharp(pathFile)
      .metadata()
      .then((metadata) => {
        const width = metadata.width;
        const height = metadata.height;

        return resolve({ width, height });
      })
      .catch((error) => {
        reject(error);
      });
  });
};
