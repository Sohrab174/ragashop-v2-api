import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Customer } from "./Customer";
import { Gateway } from "./Gateway";
import { Order } from "./Order";

@Index("fk_transaction_order1_idx", ["orderId"], {})
@Index("fk_transaction_customer1_idx", ["customerId"], {})
@Index("fk_transaction_gateway1_idx", ["gatewayId"], {})
@Entity("transaction", { schema: "ragashop" })
export class Transaction {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("int", { name: "orderId" })
  orderId: number;

  @Column("int", { name: "customerId" })
  customerId: number;

  @Column("int", { name: "gatewayId" })
  gatewayId: number;

  @Column("decimal", { name: "amount", precision: 20, scale: 2 })
  amount: string;

  @Column("varchar", { name: "referenceNumber", nullable: true, length: 128 })
  referenceNumber: string | null;

  @Column("varchar", { name: "randomToken", nullable: true, length: 128 })
  randomToken: string | null;

  @Column("varchar", { name: "terminalId", nullable: true, length: 45 })
  terminalId: string | null;

  @Column("varchar", { name: "merchantId", nullable: true, length: 128 })
  merchantId: string | null;

  @Column("varchar", { name: "payToken", nullable: true, length: 128 })
  payToken: string | null;

  @Column("varchar", { name: "trackingCode", nullable: true, length: 128 })
  trackingCode: string | null;

  @Column("int", { name: "verifyStatusNumber", nullable: true })
  verifyStatusNumber: number | null;

  @Column("varchar", { name: "verifyStatusCode", nullable: true, length: 45 })
  verifyStatusCode: string | null;

  @Column("varchar", { name: "maskedCardNumber", nullable: true, length: 45 })
  maskedCardNumber: string | null;

  @Column("varchar", { name: "hashedCardNumber", nullable: true, length: 128 })
  hashedCardNumber: string | null;

  @Column("decimal", {
    name: "reduceCardAmount",
    precision: 10,
    scale: 2,
    default: () => "'0.00'",
  })
  reduceCardAmount: string;

  @Column("varchar", { name: "rnn", nullable: true, length: 128 })
  rnn: string | null;

  @Column("datetime", { name: "paidAt", nullable: true })
  paidAt: Date | null;

  @Column("varchar", { name: "message", nullable: true, length: 255 })
  message: string | null;

  @Column("varchar", { name: "ip", nullable: true, length: 45 })
  ip: string | null;

  @Column("enum", {
    name: "status",
    enum: ["pending", "paid", "failed"],
    default: () => "'pending'",
  })
  status: "pending" | "paid" | "failed";

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;

  @ManyToOne(() => Customer, (customer) => customer.transactions, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "customerId", referencedColumnName: "id" }])
  customer: Customer;

  @ManyToOne(() => Gateway, (gateway) => gateway.transactions, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "gatewayId", referencedColumnName: "id" }])
  gateway: Gateway;

  @ManyToOne(() => Order, (order) => order.transactions, {
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  })
  @JoinColumn([{ name: "orderId", referencedColumnName: "id" }])
  order: Order;
}
