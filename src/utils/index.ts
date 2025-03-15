import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import * as moment from 'jalali-moment';
import * as crypto from 'crypto';
import * as CryptoJS from 'crypto-js';
import * as dns from 'dns';
import { convertPersianToEnglishDigit } from './persianNumbers';

export const dateTime = () => {
  return moment().format('YYYY-MM-DD HH:mm:ss');
};

export const toQueryString = (obj, showEmptyValue = false) => {
  const parts = [];
  for (const i in obj) {
    if (obj.hasOwnProperty(i)) {
      const value = obj[i] ? encodeURIComponent(obj[i]) : '';
      if (value || showEmptyValue) {
        parts.push(`${i}=${value}`);
      }
    }
  }
  return parts.join('&');
};

export const getQueryParams = (queryString) => {
  const query = {};
  const pairs = (
    queryString[0] === '?' ? queryString.substr(1) : queryString
  ).split('&');
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].split('=');
    query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
  }
  return query;
};

export const randomHash = () => {
  return crypto
    .createHash('sha256')
    .update(randomStringGenerator())
    .digest('hex');
};

export const hashSHA256 = (value) => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

export const successfulResult = (
  messages = [`It's done successfully`],
  data = {},
) => {
  return {
    success: true,
    messages: messages.map((message) => message),
    data,
  };
};

export const paginationResult = (
  page: number,
  limit: number,
  totalItems: number,
) => {
  return {
    itemsPerPage: +limit,
    totalItems,
    currentPage: +page,
    totalPages: Math.ceil(totalItems / +limit),
  };
};

export const underscoreToCamelCase = (value: string) => {
  return value.replace(/_./g, (m) => m[1].toUpperCase());
};

export const applyFiltersToBuilder = (builder, filters) => {
  if (filters) {
    filters.forEach((filter) => {
      const paramsValue = {};
      const fields = [];

      filter.data.forEach((data, i) => {
        let param = `${data.field}_${i + 1}`;
        paramsValue[param] = data.value;

        if (data.comparisonOperator === 'IN') {
          param = `(:...${param})`;
        } else {
          param = `:${param}`;
        }

        let alias = '';
        if (data.field.indexOf('.') === -1) {
          alias = `${builder.alias}.`;
        }

        let dbField = `${alias}${data.field}`;
        if (data.dbFunction) {
          dbField = `${data.dbFunction}(${dbField})`;
        }

        fields.push(`${dbField} ${data.comparisonOperator} ${param}`);
      });

      builder.andWhere(
        `(${fields.join(` ${filter.logicalOperator} `)})`,
        paramsValue,
      );
    });
  }

  return builder;
};

export const applySortingToBuilder = (builder, sorts) => {
  if (sorts) {
    sorts.forEach((sort) => {
      builder.addOrderBy(
        `${sort.field.indexOf('.') === -1 ? `${builder.alias}.` : ''}${
          sort.field
        }`,
        sort.dir,
      );
    });
  }
  return builder;
};

export const removeSpace = (value, replaceWith = '-') => {
  value = String(value);
  return value.replace(/\s+/g, replaceWith);
};

export const getIpFromDomain = (domain): Promise<string> => {
  return new Promise((resolve, rejects) => {
    dns.resolve4(domain, (err, addresses) => {
      if (err || addresses?.length === 0) {
        rejects(err);
        return;
      }
      resolve(addresses[0]);
    });
  });
};

export const stringToBool = (str) => {
  if (typeof str === 'string') {
    return str === '1' || str === 'true';
  }

  return str;
};

export const jsonStringToObject = (str) => {
  if (typeof str === 'string') {
    return JSON.parse(str);
  }

  return str;
};

export const encryptByPassword = (str: string, password: string): string => {
  const encrypted = CryptoJS.AES.encrypt(str, password).toString();
  const hexEncrypted = encrypted
    .split('')
    .map((char) => char.charCodeAt(0).toString(16))
    .join('');
  return hexEncrypted;
};

export const decryptByPassword = (
  encryptedStr: string,
  password: string,
): string => {
  const encryptedHex = encryptedStr
    .match(/.{1,2}/g)
    .map((byte) => String.fromCharCode(parseInt(byte, 16)))
    .join('');

  const decrypted = CryptoJS.AES.decrypt(encryptedHex, password).toString(
    CryptoJS.enc.Utf8,
  );
  return decrypted;
};

export const getDuplicateItems = (list, uniqueKey): any | null => {
  const obj = {};

  list.forEach((item) => {
    obj[item[uniqueKey]] = [...(obj?.[item[uniqueKey]] || []), item];
  });

  const output = Object.values(obj).filter((arr: any) => arr.length > 1);
  if (output.length > 0) {
    return output[0];
  }
  return null;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const findCategoryParentsByChildId = (categories, childId) => {
  for (const category of categories) {
    if (category.id === childId) {
      return [category]; // Found the target category
    }

    if (category.subCategories) {
      const foundInSubcategories = findCategoryParentsByChildId(
        category.subCategories,
        childId,
      );
      if (foundInSubcategories.length > 0) {
        return [category, ...foundInSubcategories]; // Found in subcategories
      }
    }
  }

  return []; // Category not found
};

export const generateRandomAlphaDigitCode = (length: number) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }

  return code;
};

export const generateRandomDigitCode = (length: number) => {
  const characters = '0123456789';
  let code = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }

  return code;
};

export const digit = (value) => {
  if (!value) return '0';
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const sliceText = (text, maxLength = 160) => {
  if (text.length <= maxLength) {
    return text;
  }

  let slicedText = text.slice(0, maxLength);
  const lastSpaceIndex = slicedText.lastIndexOf(' ');

  if (lastSpaceIndex !== -1) {
    slicedText = slicedText.slice(0, lastSpaceIndex);
  }

  return slicedText;
};

export const removeDuplicate = (arr) =>
  arr
    .filter((value) => !!value)
    .filter((value, index, array) => array.indexOf(value) === index);

export const removeDuplicateByKey = (arr, key = 'name') =>
  arr
    .filter((value) => !!value)
    .filter(
      (value, index, array) =>
        array.findIndex((item) => item[key] === value[key]) === index,
    );

export const prettyText = (value) => {
  if (value === null) return null;

  return convertPersianToEnglishDigit(
    `${value || ''}`
      .replace(/\n/g, '{{ENTER}}')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/{{ENTER}}/g, '\n'),
  );
};
