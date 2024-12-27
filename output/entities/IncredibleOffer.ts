import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Product } from "./Product";
import { ProductAttributeValue } from "./ProductAttributeValue";

@Index("fk_incredible_offer_product1_idx", ["productId"], {})
@Index(
  "fk_incredible_offer_product_attribute_value1_idx",
  ["productAttributeValueId"],
  {}
)
@Entity("incredible_offer", { schema: "ragashop" })
export class IncredibleOffer {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "productId" })
  productId: number;

  @Column("int", { name: "productAttributeValueId", nullable: true })
  productAttributeValueId: number | null;

  @Column("decimal", { name: "discountedPrice", precision: 20, scale: 2 })
  discountedPrice: string;

  @Column("decimal", { name: "discountPercent", precision: 10, scale: 2 })
  discountPercent: string;

  @Column("datetime", { name: "fromDate" })
  fromDate: Date;

  @Column("datetime", { name: "toDate" })
  toDate: Date;

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @ManyToOne(() => Product, (product) => product.incredibleOffers, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "productId", referencedColumnName: "id" }])
  product: Product;

  @ManyToOne(
    () => ProductAttributeValue,
    (productAttributeValue) => productAttributeValue.incredibleOffers,
    { onDelete: "NO ACTION", onUpdate: "NO ACTION" }
  )
  @JoinColumn([{ name: "productAttributeValueId", referencedColumnName: "id" }])
  productAttributeValue: ProductAttributeValue;
}
