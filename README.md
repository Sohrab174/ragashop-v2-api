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

## Launch security (production ENV)

| Variable | Required in production | Format / notes |
|----------|------------------------|----------------|
| `CORS_ORIGINS` | **Yes** | Comma-separated **exact** origins, e.g. `https://shop.example.com,https://admin.example.com`. No wildcards / substring matching. Missing/empty → process refuses to start. |
| `SWAGGER_ENABLED` | No | Default **false** in production, **true** otherwise. Set `true` only when docs must be temporarily exposed. |
| `TRUST_PROXY_MODE` | Recommended | `off` (default) or `hops`. Use `hops` only behind a trusted reverse proxy. |
| `TRUST_PROXY_HOPS` | When mode=`hops` | Integer 1–10. Typical single proxy: `1`. |
| `TRUST_PROXY` | Legacy | `true`/`false` if `TRUST_PROXY_MODE` unset. Prefer `TRUST_PROXY_MODE`. |
| `AUTH_RATE_LIMIT_*` | No | Optional overrides for login/OTP IP + identity windows (see `env.sample`). Defaults are production-safe. |

**Proxy assumption:** Client IP for rate limiting comes from Express `req.ip` after the configured trust-proxy hop count. Attackers must not be able to set the trusted hop via `X-Forwarded-For`.

**Rate-limit storage:** In-memory per Node process (same pattern as marketplace import). Effective for a single API instance. Multi-instance deployments need an edge limiter or shared store.

**FX mutation:** `PUT /settings/try-to-rial` requires staff JWT + `settings.fx_refresh` capability (admins always pass). Public `GET /settings` remains read-only.