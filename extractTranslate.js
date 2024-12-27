// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const glob = require('glob');

const translatedLanguage = 'fa';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const translated = require(`./src/i18n/${translatedLanguage}/t.json`);

const srcDir = './src';
const outputFilePath = './extracted.txt';

// Find all files in the src directory
const files = glob.sync(`${srcDir}/**/*.*`);

const extractedTexts = [];

// Loop through all files in the src directory
for (const file of files) {
  // Read the file contents
  const content = fs.readFileSync(file, 'utf-8');

  // Extract text wrapped in i18n.t() function calls
  const regex = /i18n\.t\('([^']+)'\)/g;
  let match;

  while ((match = regex.exec(content))) {
    const text = `"${match[1].substring(2)}": "${match[1].substring(2)}",`;

    if (match[1].substring(0, 2) !== 't.') {
      console.log(`!!!!! ${match[1]}`);
    }
    // not exist
    else if (
      extractedTexts.indexOf(text) === -1 &&
      !translated?.[match[1].substring(2)]
    ) {
      extractedTexts.push(text);
    }
  }
}

// Write the extracted text to a file
fs.writeFileSync(outputFilePath, extractedTexts.join('\n'));

console.log(`Extracted text written to ${outputFilePath}`);
