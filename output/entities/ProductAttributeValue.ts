import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import { IncredibleOffer } from "./IncredibleOffer";
import { OrderItem } from "./OrderItem";
import { AttributeValue } from "./AttributeValue";
import { Product } from "./Product";

@Index("fk_product_attribute_value_product1_idx", ["productId"], {})
@Index(
  "fk_product_attribute_value_attribute_value1_idx",
  ["attributeValueId"],
  {}
)
@Entity("product_attribute_value", { schema: "ragashop" })
export class ProductAttributeValue {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "productId" })
  productId: number;

  @Column("int", { name: "attributeValueId" })
  attributeValueId: number;

  @Column("varchar", { name: "number", nullable: true, length: 45 })
  number: string | null;

  @Column("int", { name: "quantity", nullable: true })
  quantity: number | null;

  @Column("decimal", { name: "price", nullable: true, precision: 20, scale: 2 })
  price: string | null;

  @Column("decimal", {
    name: "discountedPrice",
    nullable: true,
    precision: 20,
    scale: 2,
  })
  discountedPrice: string | null;

  @Column("decimal", {
    name: "discountPercent",
    nullable: true,
    precision: 10,
    scale: 2,
  })
  discountPercent: string | null;

  @Column("tinyint", { name: "isDeleted", width: 1 })
  isDeleted: boolean;

  @OneToMany(
    () => IncredibleOffer,
    (incredibleOffer) => incredibleOffer.productAttributeValue
  )
  incredibleOffers: IncredibleOffer[];

  @OneToMany(() => OrderItem, (orderItem) => orderItem.productAttributeValue)
  orderItems: OrderItem[];

  @ManyToOne(
    () => AttributeValue,
    (attributeValue) => attributeValue.productAttributeValues,
    { onDelete: "NO ACTION", onUpdate: "NO ACTION" }
  )
  @JoinColumn([{ name: "attributeValueId", referencedColumnName: "id" }])
  attributeValue: AttributeValue;

  @ManyToOne(() => Product, (product) => product.productAttributeValues, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "productId", referencedColumnName: "id" }])
  product: Product;
}
