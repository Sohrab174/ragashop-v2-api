import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Order } from "./Order";
import { Transaction } from "./Transaction";

@Entity("customer", { schema: "ragashop" })
export class Customer {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("varchar", { name: "firstName", nullable: true, length: 255 })
  firstName: string | null;

  @Column("varchar", { name: "lastName", nullable: true, length: 255 })
  lastName: string | null;

  @Column("varchar", { name: "mobile", nullable: true, length: 45 })
  mobile: string | null;

  @Column("varchar", { name: "email", nullable: true, length: 255 })
  email: string | null;

  @Column("varchar", { name: "password", nullable: true, length: 128 })
  password: string | null;

  @Column("text", { name: "address", nullable: true })
  address: string | null;

  @Column("varchar", { name: "randomHash", nullable: true, length: 128 })
  randomHash: string | null;

  @Column("datetime", { name: "expireRandomHash", nullable: true })
  expireRandomHash: Date | null;

  @Column("enum", {
    name: "status",
    enum: ["active", "inactive", "banned"],
    default: () => "'active'",
  })
  status: "active" | "inactive" | "banned";

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @OneToMany(() => Order, (order) => order.customer)
  orders: Order[];

  @OneToMany(() => Transaction, (transaction) => transaction.customer)
  transactions: Transaction[];
}
