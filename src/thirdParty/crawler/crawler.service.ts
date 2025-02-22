import { Injectable } from '@nestjs/common';
import axios from 'axios';
// import * as cheerio from 'cheerio';
import { Translate } from '@google-cloud/translate/build/src/v2';
import OpenAI from 'openai';

@Injectable()
export class CrawlerService {
  private axios;
  private translate: Translate;
  private openai: OpenAI;

  constructor() {
    this.axios = axios.create({
      baseURL: 'https://apigw.trendyol.com',
      timeout: 60000,
    });

    this.translate = new Translate({
      key: 'AIzaSyBHGqx0yujSMl5r0dQfTjdTQ5JjB4fl9eo',
    });

    this.openai = new OpenAI({
      apiKey:
        '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',
    });
  }

  /**
   * -----------------------------------------
   */
  async getProducts() {
    const final = [];

    // delivery
    // https://apigw.trendyol.com/discovery-pdp-websfxproductdeliverydate-santral/delivery-date/346966279?itemNumber=555539431&winnerListingId=6cfb840ae4d1f02b9cf3bdb0e10d60f0&culture=tr-TR&channelId=1&storefrontId=1

    try {
      const response = await this.axios.get(
        '/discovery-web-websfxproductgroups-santral/api/v2/product-groups?productGroupIds=27641323&productGroupIds=325807872&productGroupIds=577308862&productGroupIds=324108132&productGroupIds=508647057&productGroupIds=4969769&productGroupIds=658127160&productGroupIds=140481374&productGroupIds=28732784&productGroupIds=609662952&productGroupIds=673799755&productGroupIds=597144284&productGroupIds=319068711&productGroupIds=29688038&productGroupIds=589291867&productGroupIds=324108132&productGroupIds=29688038&productGroupIds=504068732&productGroupIds=297093877&productGroupIds=319394894&productGroupIds=661989543&productGroupIds=151337933&productGroupIds=27641323&productGroupIds=578639901&searchAbDecider=SearchFETestV1_B,BMSA_B,DsNlp_2,AdvertSlotPeriod_2,LBB_B,RRIn_B,SCB_B,SuggestionHighlight_B,BP_B,CatTR_B,CA_B,SuggestionTermActive_B,AZSmartlisting_62,BH2_B,MB_B,FRA_2,MRF_1,ARR_B,MA_B,SP_B,PastSearches_B,SuggestionJFYProducts_B,SuggestionQF_B,BSA_D,BadgeBoost_A,Relevancy_1,FilterRelevancy_1,Smartlisting_65,SuggestionBadges_B,ProductGroupTopPerformer_B,OpenFilterToggle_2,RR_2,BS_2,SuggestionPopularCTR_B&channelId=1',
      );

      const json = response.data;

      // let prevName = null;
      // let translatedName = null;

      for (const [groupId, products] of Object.entries(json.result)) {
        for (const product of products as any) {
          // if (prevName !== product.name) {
          //   translatedName = await this.translateText(product.name);
          //   prevName = product.name;
          // } else {
          //   console.log('repeated');
          // }

          final.push({
            source: 'trendyol',
            sourceId: product.id,
            sourceName: product.name,
            name: product.name, // translatedName,
            sourceUrl: product.url,
            sourceGroupId: groupId,
            coverPath: product.imageUrl,
            price: product.price.originalPrice,
            discountedPrice: product.price.discountedPrice,
            currency:
              product.price.currency === 'TL' ? 'TRY' : product.price.currency,
          });
        }
      }

      // console.log(json);

      // // پردازش HTML با cheerio
      // const $ = cheerio.load(html);

      // // انتخاب عناصر مورد نظر (به عنوان مثال، محصولات)
      // const products: { name: string; price: string }[] = [];
      // $('.p-card-wrppr').each((index, element) => {
      //   const name = $(element).find('.prdct-desc-cntnr-name').text().trim();
      //   const price = $(element).find('.prc-box-dscntd').text().trim();

      //   products.push({ name, price });
      // });

      return final;
    } catch (error) {
      console.error('Error crawling Trendyol:', error);
      throw new Error('Failed to crawl Trendyol');
    }
  }

  /**
   * -----------------------------------------
   */
  async getProductById(id: string) {
    try {
      const { data } = await this.axios.get(
        `https://apigw.trendyol.com/discovery-web-productgw-service/api/productDetail/${id}?storefrontId=1&culture=tr-TR&linearVariants=true&isLegalRequirementConfirmed=false&channelId=1`,
      );
      const product = data.result;

      return {
        source: 'trendyol',
        sourceId: product.id,
        sourceName: product.name,
        name: product.name, // translatedName,
        number: product.productCode,
        sourceUrl: product.url,
        star: product?.ratingScore?.averageRating || 0,
        starCountPerson: product?.ratingScore?.totalRatingCount || 0,
        sourceGroupId: product.productGroupId,
        sizeChartUrl: product.sizeChartUrl,
        coverPath: product.imageUrl,
        price: product.price.originalPrice,
        discountedPrice: product.price.discountedPrice,
        currency:
          product.price.currency === 'TL' ? 'TRY' : product.price.currency,
      };
    } catch (error) {
      console.error('Error crawling Trendyol by id:', id, error);
      throw new Error(`Failed to crawl Trendyol by ID: ${id}`);
    }
  }

  /**
   * -----------------------------------------
   * translator
   */
  async translateText(text: string): Promise<string> {
    const [translatedText] = await this.translate.translate(text, 'fa');
    return translatedText;

    // const res = await this.openai.chat.completions.create({
    //   model: 'gpt-3.5-turbo',
    //   messages: [
    //     {
    //       role: 'system',
    //       content: 'You are a professional clothing store translator.',
    //     },
    //     {
    //       role: 'user',
    //       content: `Translate Turkish to Persian, my site is a cloth store:\n\n${text}`,
    //     },
    //   ],
    //   temperature: 0.3,
    // });
  }
}
