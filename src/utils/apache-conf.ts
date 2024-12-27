import * as fs from 'fs';
import * as child from 'child_process';

const virtualFilePath =
  '/usr/local/apache/conf/includes/pre_virtualhost_global.conf';

export const addNewAccountToApacheConf = async (code) => {
  return new Promise((resolve, reject) => {
    const domain = process.env.BASE_DOMAIN;

    const content = `
# ===================== ${code}.${domain} ===================== shop\n
<VirtualHost ${code}.${domain}:80>
    ServerName ${code}.${domain}
    Redirect / https://${code}.${domain}/
</VirtualHost>

<VirtualHost ${code}.${domain}:443>
    ServerName ${code}.${domain}
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/${domain}/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/${domain}/privkey.pem
    ProxyPreserveHost On
    ProxyPass / http://localhost:3004/
    ProxyPassReverse / http://localhost:3004/
</VirtualHost>
`;

    fs.appendFileSync(virtualFilePath, content);

    child.exec('/bin/systemctl restart httpd.service', (err, stdout) => {
      if (err) {
        console.error(err);
        return reject(false);
      }

      console.log(stdout, 'Apache restart', new Date());
      resolve(true);
    });
  });
};
