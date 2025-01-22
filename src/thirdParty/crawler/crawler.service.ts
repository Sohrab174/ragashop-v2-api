import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

@Injectable()
export class CrawlerService {
  private axios;

  constructor() {
    this.axios = axios.create({
      baseURL: 'https://apigw.trendyol.com',
      timeout: 60000,
    });
  }

  /**
   * -----------------------------------------
   */
  async getProducts() {
    const final = [];

    try {
      // ارسال درخواست به سایت Trendyol
      const response = await this.axios.get(
        '/discovery-web-websfxproductgroups-santral/api/v2/product-groups?productGroupIds=27641323&productGroupIds=325807872&productGroupIds=577308862&productGroupIds=324108132&productGroupIds=508647057&productGroupIds=4969769&productGroupIds=658127160&productGroupIds=140481374&productGroupIds=28732784&productGroupIds=609662952&productGroupIds=673799755&productGroupIds=597144284&productGroupIds=319068711&productGroupIds=29688038&productGroupIds=589291867&productGroupIds=324108132&productGroupIds=29688038&productGroupIds=504068732&productGroupIds=297093877&productGroupIds=319394894&productGroupIds=661989543&productGroupIds=151337933&productGroupIds=27641323&productGroupIds=578639901&searchAbDecider=SearchFETestV1_B,BMSA_B,DsNlp_2,AdvertSlotPeriod_2,LBB_B,RRIn_B,SCB_B,SuggestionHighlight_B,BP_B,CatTR_B,CA_B,SuggestionTermActive_B,AZSmartlisting_62,BH2_B,MB_B,FRA_2,MRF_1,ARR_B,MA_B,SP_B,PastSearches_B,SuggestionJFYProducts_B,SuggestionQF_B,BSA_D,BadgeBoost_A,Relevancy_1,FilterRelevancy_1,Smartlisting_65,SuggestionBadges_B,ProductGroupTopPerformer_B,OpenFilterToggle_2,RR_2,BS_2,SuggestionPopularCTR_B&channelId=1',
      );

      const json = response.data;

      Object.entries(json.result).forEach(([groupId, products]) => {
        const items: any = products;
        items.forEach((product) => {
          final.push({
            source: 'trendyol',
            sourceId: product.id,
            sourceName: product.name,
            sourceUrl: product.url,
            sourceGroupId: groupId,
            coverPath: product.imageUrl,
            price: product.price.originalPrice,
            discountedPrice: product.price.discountedPrice,
            currency: product.price.currency,
          });
        });
      });

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
}
