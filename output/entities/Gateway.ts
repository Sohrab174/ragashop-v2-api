import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Transaction } from "./Transaction";

@Entity("gateway", { schema: "ragashop" })
export class Gateway {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("enum", {
    name: "name",
    enum: ["sep", "bpm", "zarinpal", "payping", "zibal", "dpo-pay"],
    default: () => "'sep'",
  })
  name: "sep" | "bpm" | "zarinpal" | "payping" | "zibal" | "dpo-pay";

  @Column("varchar", { name: "merchantId", nullable: true, length: 255 })
  merchantId: string | null;

  @Column("varchar", { name: "username", nullable: true, length: 255 })
  username: string | null;

  @Column("varchar", { name: "password", nullable: true, length: 255 })
  password: string | null;

  @Column("int", { name: "displayOrder", default: () => "'1'" })
  displayOrder: number;

  @Column("enum", {
    name: "status",
    enum: ["active", "inactive"],
    default: () => "'active'",
  })
  status: "active" | "inactive";

  @Column("tinyint", { name: "isDeleted", default: () => "'0'" })
  isDeleted: number;

  @OneToMany(() => Transaction, (transaction) => transaction.gateway)
  transactions: Transaction[];
}
