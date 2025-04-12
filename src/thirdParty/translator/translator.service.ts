import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ConfigurationService } from '../../config/configuration.service';

@Injectable()
export class TranslatorService {
  private axios;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      baseURL: 'https://api.deepseek.com',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.AI.deepseekToken}`,
      },
    });
  }

  /**
   * -----------------------------------------
   * translator
   */
  async text(text: string) {
    try {
      const response = await this.axios.post('/chat/completions', {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content:
              'You are a professional translator. Please translate only the exact content of the Turkish product description into Persian, without adding any extra details or explanations. Keep it concise and direct, suitable for an online fashion store.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        stream: false,
      });

      // Return the translated text from the response
      const translated = response.data.choices[0].message.content;

      console.log({ text, translated });
      return translated;
    } catch (error: any) {
      console.error(
        'Translation failed:',
        error?.response?.data || error.message,
      );
      return null;
    }
  }

  /**
   * -----------------------------------------
   * translator
   */
  async array(texts: string[]) {
    try {
      const response = await this.axios.post('/chat/completions', {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content:
              'You are a professional translator. Please translate only the exact content of the Turkish product description into Persian, without adding any extra details or explanations. Keep it concise and direct, suitable for an online fashion store. Return the translations as a valid JSON array of strings, like: ["translation1", "translation2", "translation3", ...]. Do not include any extra formatting or metadata.',
          },
          {
            role: 'user',
            content: JSON.stringify(texts),
          },
        ],
        stream: false,
      });

      console.log(response.data.choices);

      // Return the translated text from the response
      const translateds = JSON.parse(
        response.data.choices[0].message.content || '',
      );

      console.log({ texts, translateds });

      return texts.map((text, index) => ({
        text,
        translated: translateds[index] || text,
      }));
    } catch (error: any) {
      console.error(
        'Translation failed:',
        error?.response?.data || error.message,
      );
      return [];
    }
  }
}
