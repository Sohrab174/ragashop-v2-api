import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("user", { schema: "ragashop" })
export class User {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("varchar", { name: "firstName", length: 255 })
  firstName: string;

  @Column("varchar", { name: "lastName", length: 255 })
  lastName: string;

  @Column("varchar", { name: "mobile", nullable: true, length: 45 })
  mobile: string | null;

  @Column("varchar", { name: "email", length: 255 })
  email: string;

  @Column("varchar", { name: "password", length: 128 })
  password: string;

  @Column("enum", { name: "role", enum: ["god", "admin", "employee"] })
  role: "god" | "admin" | "employee";

  @Column("varchar", { name: "randomHash", nullable: true, length: 128 })
  randomHash: string | null;

  @Column("datetime", { name: "expireRandomHash", nullable: true })
  expireRandomHash: Date | null;

  @Column("enum", {
    name: "status",
    enum: ["active", "inactive"],
    default: () => "'active'",
  })
  status: "active" | "inactive";

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;
}
