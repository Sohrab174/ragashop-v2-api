import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
dotenv.config();

type App = {
  nodeEnv: string;
  name: string;
  type: string;
  workingDirectory: string;
  port: number;
  panelBaseUrl: string;
  apiBaseUrl: string;
  siteBaseUrl: string;
  baseDomain: string;
};
type Auth = {
  secret: string;
  expires: string;
  expiresLifetime: string;
  customerSecret: string;
};
type Mail = {
  port: number;
  host: string;
  user: string;
  password: string;
  defaultEmail: string;
  defaultName: string;
  ignoreTLS: boolean;
  secure: boolean;
  requireTLS: boolean;
  salesEmail: string;
};
type Sms = {
  kavenegarKey: string;
  amootsmsUsername: string;
  amootsmsPassword: string;
  countAlert: number;
  vatansmsApiId: string;
  vatansmsApiKey: string;
};
type Gateway = {
  mode: string; // live or sandbox
};
type PasswordCrypto = {
  file: string;
};
type AI = {
  deepseekToken: string;
};

@Injectable()
export class ConfigurationService {
  public app: App;
  public auth: Auth;
  public mail: Mail;
  public sms: Sms;
  public gateway: Gateway;
  public passwordCrypto: PasswordCrypto;
  public AI: AI;

  constructor() {
    this.getEnv();
  }

  async getEnv() {
    const env = process.env;

    this.app = {
      nodeEnv: env.NODE_ENV,
      name: env.APP_NAME,
      type: env.APP_TYPE,
      workingDirectory: env.PWD || process.cwd(),
      port: parseInt(env.APP_PORT || env.PORT, 10) || 3000,
      panelBaseUrl: env.PANEL_BASE_URL,
      apiBaseUrl: env.API_BASE_URL,
      siteBaseUrl: env.SITE_BASE_URL,
      baseDomain: env.BASE_DOMAIN,
    };

    this.auth = {
      secret: env.AUTH_JWT_SECRET,
      expires: env.AUTH_JWT_TOKEN_EXPIRES_IN,
      expiresLifetime: env.AUTH_JWT_TOKEN_LIFETIME_EXPIRES_IN,
      customerSecret: env.CUSTOMER_JWT_SECRET,
    };

    this.mail = {
      port: parseInt(env.MAIL_PORT, 10),
      host: env.MAIL_HOST,
      user: env.MAIL_USER,
      password: env.MAIL_PASSWORD,
      defaultEmail: env.MAIL_DEFAULT_EMAIL,
      salesEmail: env.MAIL_SALES_EMAIL,
      defaultName: env.MAIL_DEFAULT_NAME,
      ignoreTLS: env.MAIL_IGNORE_TLS === 'true',
      secure: env.MAIL_SECURE === 'true',
      requireTLS: env.MAIL_REQUIRE_TLS === 'true',
    };

    this.sms = {
      kavenegarKey: env.KAVENEGAR_SECRET_KEY,
      amootsmsUsername: env.AMOOTSMS_USERNAME,
      amootsmsPassword: env.AMOOTSMS_PASSWORD,
      countAlert: parseInt(env.SMS_COUNT_ALERT, 10),
      vatansmsApiId: env.VATANSMS_API_ID,
      vatansmsApiKey: env.VATANSMS_API_KEY,
    };

    this.gateway = {
      mode: env.GATEWAY_MODE,
    };

    this.passwordCrypto = {
      file: env.PASSWORD_CRYPTO_FILE,
    };

    this.AI = {
      deepseekToken: env.AI_DEEPSEEK_TOKEN,
    };
  }
}
