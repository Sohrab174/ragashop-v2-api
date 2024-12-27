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
import { Brand } from "./Brand";
import { Category } from "./Category";
import { ProductGallery } from "./ProductGallery";
import { ProductAttributeValue } from "./ProductAttributeValue";

@Index("fk_product_category1_idx", ["categoryId"], {})
@Index("fk_product_brand1_idx", ["brandId"], {})
@Index("fk_product_product_gallery1_idx", ["coverId"], {})
@Entity("product", { schema: "ragashop" })
export class Product {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("varchar", { name: "number", nullable: true, length: 45 })
  number: string | null;

  @Column("int", { name: "categoryId" })
  categoryId: number;

  @Column("int", { name: "brandId", nullable: true })
  brandId: number | null;

  @Column("int", { name: "sourceId", nullable: true })
  sourceId: number | null;

  @Column("varchar", { name: "sourceGroupId", nullable: true, length: 128 })
  sourceGroupId: string | null;

  @Column("enum", {
    name: "source",
    enum: ["trendyol"],
    default: () => "'trendyol'",
  })
  source: "trendyol";

  @Column("varchar", { name: "name", length: 255 })
  name: string;

  @Column("varchar", { name: "sourceName", nullable: true, length: 255 })
  sourceName: string | null;

  @Column("int", { name: "coverId", nullable: true })
  coverId: number | null;

  @Column("varchar", { name: "code", nullable: true, length: 45 })
  code: string | null;

  @Column("enum", {
    name: "currency",
    enum: ["USD", "TRY", "IRT"],
    default: () => "'TRY'",
  })
  currency: "USD" | "TRY" | "IRT";

  @Column("decimal", { name: "price", precision: 20, scale: 2 })
  price: string;

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

  @Column("int", { name: "quantity" })
  quantity: number;

  @Column("enum", { name: "gender", nullable: true, enum: ["male", "female"] })
  gender: "male" | "female" | null;

  @Column("text", { name: "description", nullable: true })
  description: string | null;

  @Column("text", { name: "sourceDescription", nullable: true })
  sourceDescription: string | null;

  @Column("int", { name: "displayOrder", nullable: true })
  displayOrder: number | null;

  @Column("enum", {
    name: "status",
    enum: ["active", "inactive", "draft"],
    default: () => "'draft'",
  })
  status: "active" | "inactive" | "draft";

  @Column("datetime", { name: "lastCrawlingAt", nullable: true })
  lastCrawlingAt: Date | null;

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @OneToMany(
    () => IncredibleOffer,
    (incredibleOffer) => incredibleOffer.product
  )
  incredibleOffers: IncredibleOffer[];

  @OneToMany(() => OrderItem, (orderItem) => orderItem.product)
  orderItems: OrderItem[];

  @ManyToOne(() => Brand, (brand) => brand.products, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "brandId", referencedColumnName: "id" }])
  brand: Brand;

  @ManyToOne(() => Category, (category) => category.products, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "categoryId", referencedColumnName: "id" }])
  category: Category;

  @ManyToOne(
    () => ProductGallery,
    (productGallery) => productGallery.products,
    { onDelete: "NO ACTION", onUpdate: "NO ACTION" }
  )
  @JoinColumn([{ name: "coverId", referencedColumnName: "id" }])
  cover: ProductGallery;

  @OneToMany(
    () => ProductAttributeValue,
    (productAttributeValue) => productAttributeValue.product
  )
  productAttributeValues: ProductAttributeValue[];

  @OneToMany(() => ProductGallery, (productGallery) => productGallery.product)
  productGalleries: ProductGallery[];
}
