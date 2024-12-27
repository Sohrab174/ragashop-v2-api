import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Product } from "./Product";

@Index("fk_category_category1_idx", ["parentId"], {})
@Entity("category", { schema: "ragashop" })
export class Category {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "sourceId" })
  sourceId: number;

  @Column("int", { name: "parentId", nullable: true })
  parentId: number | null;

  @Column("varchar", { name: "name", length: 255 })
  name: string;

  @Column("varchar", { name: "iconPath", nullable: true, length: 128 })
  iconPath: string | null;

  @Column("int", { name: "displayOrder", nullable: true })
  displayOrder: number | null;

  @Column("tinyint", { name: "isSelection", width: 1, default: () => "'0'" })
  isSelection: boolean;

  @Column("enum", {
    name: "status",
    enum: ["active", "inactive"],
    default: () => "'active'",
  })
  status: "active" | "inactive";

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @ManyToOne(() => Category, (category) => category.categories, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "parentId", referencedColumnName: "id" }])
  parent: Category;

  @OneToMany(() => Category, (category) => category.parent)
  categories: Category[];

  @OneToMany(() => Product, (product) => product.category)
  products: Product[];
}
