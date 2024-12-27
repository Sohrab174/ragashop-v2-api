## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Developing

Create a migration

```bash
$ yarn migration:create MIGRATION_NAME
```

Run migrations

```bash
$ yarn migration:run
```

# Seed

```bash
$ yarn seed:run
```

# Applying tables to entities

```bash
$ npx typeorm-model-generator -h localhost -d ragashop -u root -e mysql -x
```

## PM2

```bash
$ pm2 start npm --name "ragashop_api" -- start
```

## Apache configuration

```
<VirtualHost example.com:80>
        ServerName example.com
        Redirect / https://example.com/
</VirtualHost>

<VirtualHost example.com:443>
    ServerName example.com
    SSLEngine on
    SSLCertificateFile /home/example/ssl/certs/example_...7c53.crt
    SSLCertificateKeyFile /home/example/ssl/keys/a4511_...bde.key
    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
</VirtualHost>
```
