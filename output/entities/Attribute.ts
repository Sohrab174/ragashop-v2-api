import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { AttributeValue } from "./AttributeValue";

@Entity("attribute", { schema: "ragashop" })
export class Attribute {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "sourceId" })
  sourceId: number;

  @Column("varchar", { name: "name", length: 255 })
  name: string;

  @Column("enum", {
    name: "type",
    enum: ["color", "other"],
    default: () => "'other'",
  })
  type: "color" | "other";

  @OneToMany(() => AttributeValue, (attributeValue) => attributeValue.attribute)
  attributeValues: AttributeValue[];
}
