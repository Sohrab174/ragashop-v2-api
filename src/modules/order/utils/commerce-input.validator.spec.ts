import { HttpException } from '@nestjs/common';
import {
  parseStrictPositiveInt,
  validateEffectiveSalePrice,
  validateOrderItemQuantity,
} from './commerce-input.validator';

describe('commerce-input.validator', () => {
  const error = {
    unprocessableEntity: jest.fn((msgs) => {
      throw new HttpException({ messages: msgs }, 422);
    }),
  };

  it.each([1, 2, 100])('accepts strict integer quantities %i', (q) => {
    expect(validateOrderItemQuantity(q, error as any)).toBe(q);
  });

  it('accepts canonical numeric strings', () => {
    expect(validateOrderItemQuantity('12', error as any)).toBe(12);
  });

  it.each([
    -1,
    0,
    1.5,
    NaN,
    Infinity,
    'abc',
    '  ',
    '1e3',
    true,
    false,
    [1],
    {},
    null,
    undefined,
  ])('rejects invalid quantity %p', (q) => {
    expect(() => validateOrderItemQuantity(q, error as any)).toThrow(
      HttpException,
    );
  });

  it.each([true, false, [1], {}, '12abc'])(
    'rejects invalid product id %p',
    (value) => {
      expect(() =>
        parseStrictPositiveInt(value, error as any, 'bad id'),
      ).toThrow(HttpException);
    },
  );

  it('rejects zero effective customer sale price', () => {
    expect(() => validateEffectiveSalePrice(1000, 0, error as any)).toThrow(
      HttpException,
    );
  });

  it('accepts positive effective sale price from discount', () => {
    expect(() =>
      validateEffectiveSalePrice(1000, 500, error as any),
    ).not.toThrow();
  });
});
