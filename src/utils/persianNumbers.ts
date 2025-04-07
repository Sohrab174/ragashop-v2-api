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

export const convertToStandardMobileFormat = (mobile: string) => {
  mobile = convertPersianToEnglishDigit(mobile);

  if (mobile.substring(0, 5) === '+9809') {
    return `+98${mobile.substring(4)}`;
  }

  if (mobile.substring(0, 2) === '00') {
    return `+${mobile.substring(2)}`;
  }

  if (mobile.substring(0, 2) === '09') {
    return `+98${mobile.substring(1)}`;
  }

  if (mobile.substring(0, 1) !== '+') {
    return `+98${mobile}`;
  }

  return mobile;
};
