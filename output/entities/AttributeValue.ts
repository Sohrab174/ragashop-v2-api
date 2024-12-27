import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Attribute } from "./Attribute";
import { ProductAttributeValue } from "./ProductAttributeValue";

@Index("fk_attribute_value_attribute1_idx", ["attributeId"], {})
@Entity("attribute_value", { schema: "ragashop" })
export class AttributeValue {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "attributeId" })
  attributeId: number;

  @Column("varchar", { name: "extraValue", nullable: true, length: 128 })
  extraValue: string | null;

  @ManyToOne(() => Attribute, (attribute) => attribute.attributeValues, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "attributeId", referencedColumnName: "id" }])
  attribute: Attribute;

  @OneToMany(
    () => ProductAttributeValue,
    (productAttributeValue) => productAttributeValue.attributeValue
  )
  productAttributeValues: ProductAttributeValue[];
}
