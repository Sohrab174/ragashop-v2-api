import {
  containsPersianScript,
  pickFirstPersianTextRow,
} from './persian-script.util';

describe('persian-script.util', () => {
  it('detects Persian text', () => {
    expect(containsPersianScript('متن فارسی')).toBe(true);
    expect(containsPersianScript('Brand رمر')).toBe(true);
  });

  it('does not treat Latin source as Persian', () => {
    expect(containsPersianScript('rammers')).toBe(false);
    expect(containsPersianScript('Wide Collar Sweatshirt')).toBe(false);
  });

  it('treats empty/null safely', () => {
    expect(containsPersianScript('')).toBe(false);
    expect(containsPersianScript('   ')).toBe(false);
    expect(containsPersianScript(null)).toBe(false);
    expect(containsPersianScript(undefined)).toBe(false);
  });

  it('picks first Persian row without SQL regex', () => {
    const rows = [
      { id: 1, name: 'rammers' },
      { id: 2, name: 'رامرز' },
      { id: 3, name: 'رامرز ۲' },
    ];
    expect(pickFirstPersianTextRow(rows)?.id).toBe(2);
    expect(pickFirstPersianTextRow([{ id: 1, name: 'latin' }])).toBeUndefined();
    expect(pickFirstPersianTextRow([])).toBeUndefined();
    expect(pickFirstPersianTextRow(null)).toBeUndefined();
  });
});
