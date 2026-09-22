import { buildSafeContentDisposition } from './content-disposition';

describe('buildSafeContentDisposition', () => {
  it('emits ASCII filename + RFC5987 filename*', () => {
    const v = buildSafeContentDisposition('receipt.jpg');
    expect(v).toContain('inline;');
    expect(v).toContain('filename="receipt.jpg"');
    expect(v).toContain("filename*=UTF-8''receipt.jpg");
  });

  it('strips CR/LF/quotes/control chars', () => {
    const v = buildSafeContentDisposition('bad\r\n"file".png');
    expect(v).not.toMatch(/[\r\n]/);
    expect(v).not.toContain('"file"');
    expect(v).toContain('filename=');
  });

  it('encodes non-ASCII in filename*', () => {
    const v = buildSafeContentDisposition('رسید.pdf');
    expect(v).toMatch(/filename\*=UTF-8''/);
    expect(v).toContain('%');
    expect(v).toMatch(/filename="[^"]+"/);
  });
});
