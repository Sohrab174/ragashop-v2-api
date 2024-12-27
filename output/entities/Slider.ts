import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("slider", { schema: "ragashop" })
export class Slider {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("enum", {
    name: "type",
    enum: ["photo", "video"],
    default: () => "'photo'",
  })
  type: "photo" | "video";

  @Column("varchar", { name: "pathFile", length: 128 })
  pathFile: string;

  @Column("varchar", { name: "title", nullable: true, length: 128 })
  title: string | null;

  @Column("text", { name: "description", nullable: true })
  description: string | null;

  @Column("varchar", { name: "url", nullable: true, length: 255 })
  url: string | null;

  @Column("enum", {
    name: "position",
    enum: ["top", "center"],
    default: () => "'top'",
  })
  position: "top" | "center";

  @Column("int", { name: "displayOrder" })
  displayOrder: number;

  @Column("datetime", { name: "createdAt" })
  createdAt: Date;
}
