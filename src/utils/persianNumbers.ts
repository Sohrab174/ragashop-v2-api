const persianNumbers = [
  /۰/g,
  /۱/g,
  /۲/g,
  /۳/g,
  /۴/g,
  /۵/g,
  /۶/g,
  /۷/g,
  /۸/g,
  /۹/g,
];
const arabicNumbers = [
  /٠/g,
  /١/g,
  /٢/g,
  /٣/g,
  /٤/g,
  /٥/g,
  /٦/g,
  /٧/g,
  /٨/g,
  /٩/g,
];

export const convertPersianToEnglishDigit = (
  num: string,
  onlyDigit = false,
) => {
  let number = `${num}`;

  for (let i = 0; i < 10; i++) {
    number = number
      .replace(persianNumbers[i], `${i}`)
      .replace(arabicNumbers[i], `${i}`);
  }

  if (onlyDigit) {
    return number.replace(/(\D)/g, '');
  }
  return number;
};

export const convertToStandardMobileFormat = (num: string) =>
  convertPersianToEnglishDigit(num)
    .replace(/[^0-9+]/g, '')
    .replace(/^(?:\+98|0098)/, '0');
