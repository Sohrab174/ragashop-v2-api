import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Product } from "./Product";

@Entity("brand", { schema: "ragashop" })
export class Brand {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "sourceId" })
  sourceId: number;

  @Column("varchar", { name: "name", length: 255 })
  name: string;

  @Column("tinyint", { name: "isSelection", width: 1, default: () => "'0'" })
  isSelection: boolean;

  @Column("text", { name: "description", nullable: true })
  description: string | null;

  @OneToMany(() => Product, (product) => product.brand)
  products: Product[];
}
