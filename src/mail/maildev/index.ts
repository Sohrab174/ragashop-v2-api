import * as MailDev from 'maildev';
import * as fs from 'fs';

const maildev = new MailDev();

maildev.listen();

maildev.on('new', function (email) {
  // We got a new email!
  const content = email.html;

  fs.writeFile(`${__dirname}/inbox/${Date.now()}.html`, content, (err) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log('A new email was received successfully...');
  });
});
