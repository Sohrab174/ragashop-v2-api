import * as sharp from 'sharp';
import {
  detectHomeRasterFormat,
  looksLikeActiveOrNonRaster,
} from './home-image-upload';

async function tinyJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
}

describe('home-image-upload security', () => {
  it('accepts real jpeg and png payloads', async () => {
    expect(await detectHomeRasterFormat(await tinyJpeg())).toBe('jpeg');
    expect(await detectHomeRasterFormat(await tinyPng())).toBe('png');
  });

  it('rejects html, svg, and script-like payloads', async () => {
    const html = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(looksLikeActiveOrNonRaster(html)).toBe(true);
    expect(looksLikeActiveOrNonRaster(svg)).toBe(true);
    expect(await detectHomeRasterFormat(html)).toBeNull();
    expect(await detectHomeRasterFormat(svg)).toBeNull();
  });

  it('rejects jpeg/png header shells that are not decodable images', async () => {
    const jpegShell = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0xff, 0xd9,
    ]);
    expect(await detectHomeRasterFormat(jpegShell)).toBeNull();
  });
});
