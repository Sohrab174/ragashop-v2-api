import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Order } from "./Order";
import { Product } from "./Product";
import { ProductAttributeValue } from "./ProductAttributeValue";

@Index("fk_order_item_order1_idx", ["orderId"], {})
@Index(
  "fk_order_item_product_attribute_value1_idx",
  ["productAttributeValueId"],
  {}
)
@Index("fk_order_item_product1_idx", ["productId"], {})
@Entity("order_item", { schema: "ragashop" })
export class OrderItem {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "orderId" })
  orderId: number;

  @Column("int", { name: "productId" })
  productId: number;

  @Column("int", { name: "productAttributeValueId", nullable: true })
  productAttributeValueId: number | null;

  @Column("decimal", { name: "price", precision: 20, scale: 2 })
  price: string;

  @Column("decimal", {
    name: "discountedPrice",
    precision: 20,
    scale: 2,
    default: () => "'0.00'",
  })
  discountedPrice: string;

  @Column("int", { name: "quantity", default: () => "'1'" })
  quantity: number;

  @Column("decimal", { name: "finalAmount", precision: 20, scale: 2 })
  finalAmount: string;

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @ManyToOne(() => Order, (order) => order.orderItems, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "orderId", referencedColumnName: "id" }])
  order: Order;

  @ManyToOne(() => Product, (product) => product.orderItems, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "productId", referencedColumnName: "id" }])
  product: Product;

  @ManyToOne(
    () => ProductAttributeValue,
    (productAttributeValue) => productAttributeValue.orderItems,
    { onDelete: "NO ACTION", onUpdate: "NO ACTION" }
  )
  @JoinColumn([{ name: "productAttributeValueId", referencedColumnName: "id" }])
  productAttributeValue: ProductAttributeValue;
}
