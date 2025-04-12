import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { MENU } from './sources/menu';

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
  async getProductGroups() {
    const filePath = path.resolve('productGroupIds.txt');

    const urls: string[] = [];

    const list = [MENU.items[0], MENU.items[1]];

    list.forEach((item) => {
      item.children?.forEach((child) => {
        child.children?.forEach((child2) => {
          if (child2.webUrl) {
            urls.push(`https://www.trendyol.com/${child2.webUrl}`);
          }
        });
      });
    });

    for (const url of urls) {
      try {
        const res = await axios.get(url);
        const matches = [...res.data.matchAll(/"productGroupId":(\d+)/g)];

        matches.forEach((match) => {
          const id = parseInt(match[1], 10);
          // Append each ID to file immediately
          fs.appendFileSync(filePath, id + '\n');
        });

        console.log(`Fetched from ${url}, found ${matches.length} IDs.`);
      } catch (error) {
        console.error(`Failed to fetch or parse ${url}`, error);
      }
    }

    console.log(
      `All productGroupIds have been saved (possibly with duplicates).`,
    );
  }

  /**
   * -----------------------------------------
   */
  async getProducts(targetGroupId) {
    const final = [];

    // delivery
    // https://apigw.trendyol.com/discovery-pdp-websfxproductdeliverydate-santral/delivery-date/346966279?itemNumber=555539431&winnerListingId=6cfb840ae4d1f02b9cf3bdb0e10d60f0&culture=tr-TR&channelId=1&storefrontId=1

    try {
      const response = await this.axios.get(
        `/discovery-web-websfxproductgroups-santral/api/v2/product-groups?productGroupIds=${targetGroupId}&searchAbDecider=SearchFETestV1_B,BMSA_B,DsNlp_2,AdvertSlotPeriod_2,LBB_B,RRIn_B,SCB_B,SuggestionHighlight_B,BP_B,CatTR_B,CA_B,SuggestionTermActive_B,AZSmartlisting_62,BH2_B,MB_B,FRA_2,MRF_1,ARR_B,MA_B,SP_B,PastSearches_B,SuggestionJFYProducts_B,SuggestionQF_B,BSA_D,BadgeBoost_A,Relevancy_1,FilterRelevancy_1,Smartlisting_65,SuggestionBadges_B,ProductGroupTopPerformer_B,OpenFilterToggle_2,RR_2,BS_2,SuggestionPopularCTR_B&channelId=1`,
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

      const result = {
        source: 'trendyol',
        sourceId: product.id,
        sourceName: product.name,
        name: product.name, // should translate this to persian
        color: product?.color || null,
        number: product.productCode,
        sourceUrl: product.url,
        star: product?.ratingScore?.averageRating || 0,
        starCountPerson: product?.ratingScore?.totalRatingCount || 0,
        sourceGroupId: product.productGroupId,
        sizeChartUrl: product.sizeChartUrl,
        coverPath: product.imageUrl,
        images: product.images,
        price: product.price.originalPrice.value,
        discountedPrice: product.price.discountedPrice.value,
        tax: product?.tax || 0,
        currency:
          product.price.currency === 'TL' ? 'TRY' : product.price.currency,
        brandId: product?.brand?.id || null,
        brandName: product?.brand?.name || null,
        isVasEnabled: product?.isVasEnabled || false,
        isSellable: product?.isSellable || false,
        isBasketDiscount: product?.isBasketDiscount || false,
        isFreeCargo: product?.isFreeCargo || false,
        isArtWork: product?.isArtWork || false,
        isDigitalGood: product?.isDigitalGood || false,
        hasStock: product?.hasStock || false,
        favoriteCount: product?.favoriteCount || 0,
        uxLayout: product?.uxLayout || null,
        categoryId: product?.category?.id || null,
        categoryName: product?.category?.name || null,
        categoryHierarchy: product?.category?.hierarchy || null,
        categoryIsVASEnabled: product?.category?.isVASEnabled || false,
        categoryBankTypeId: product?.originalCategory?.bankType?.id || null,
        categoryBankTypeName: product?.originalCategory?.bankType?.name || null,
        categoryTree: product?.webCategoryTree || [],
        descriptions: product.descriptions.map((d) => ({
          content: d.text,
          displayOrder: d.priority,
        })),
        fixAttributes: product.attributes.map((a) => ({
          id: a.key.id,
          name: a.key.name,
          // starred: a.starred,
          // description: a.description,
          value: {
            id: a.value.id,
            name: a.value.name,
          },
        })),
        selectionAttributes: product.allVariants.map((p) => ({
          value: p.value,
          inStock: p.inStock,
          currency: p.currency,
          price: p.price,
        })),
        selectionAttribute: {
          currency:
            product.merchantListings?.[0]?.variants?.[0]?.price?.currency ||
            null,
          discountedPrice:
            product.merchantListings?.[0]?.variants?.[0]?.price
              ?.discountedPrice || null,
          price:
            product.merchantListings?.[0]?.variants?.[0]?.price
              ?.originalPrice || null,
          quantity:
            product.merchantListings?.[0]?.variants?.[0]?.quantity || null,
          type:
            product.merchantListings?.[0]?.variants?.[0]?.variantAttributes?.[0]
              ?.attributeType || null,
          name:
            product.merchantListings?.[0]?.variants?.[0]?.variantAttributes?.[0]
              ?.attributeName || null,
          attributeId:
            product.merchantListings?.[0]?.variants?.[0]?.variantAttributes?.[0]
              ?.attributeId || null,
        },
        attributes: {},
      };

      result.attributes = [
        ...result.selectionAttributes.map((sa) => ({
          id: result.selectionAttribute.attributeId,
          name: result.selectionAttribute.name,
          value: {
            id: null,
            name: sa.value,
            currency: sa.currency,
            discountedPrice: result.selectionAttribute.discountedPrice,
            discountPercent: result.selectionAttribute.discountedPrice
              ? (1 - result.selectionAttribute.discountedPrice / sa.price) * 100
              : 0,
            price: sa.price,
            quantity: sa.inStock ? -1 : 0,
          },
        })),
        ...result.fixAttributes.map((fa) => ({
          id: fa.id,
          name: fa.name,
          value: {
            id: fa.value.id,
            name: fa.value.name,
            currency: null,
            discountedPrice: null,
            discountPercent: 0,
            price: null,
            quantity: -1,
          },
        })),
      ];

      console.log({ sourceName: result.sourceName });

      return result;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return null;
      }
      console.error('Error crawling Trendyol by id:', id, error);
      throw new Error(`Failed to crawl Trendyol by ID: ${id}`);
    }
  }
}
