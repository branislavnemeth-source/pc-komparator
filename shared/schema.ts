import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const computers = sqliteTable("computers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  name: text("name"),
  brand: text("brand"),
  price: text("price"),
  priceNumeric: integer("price_numeric"),
  currency: text("currency"),
  processor: text("processor"),
  ram: text("ram"),
  storage: text("storage"),
  gpu: text("gpu"),
  display: text("display"),
  os: text("os"),
  weight: text("weight"),
  battery: text("battery"),
  imageUrl: text("image_url"),
  eshopName: text("eshop_name"),
  availability: text("availability"),
  rawData: text("raw_data"),
  sessionId: text("session_id").notNull(),
  fetchedAt: text("fetched_at"),
});

export const insertComputerSchema = createInsertSchema(computers).omit({
  id: true,
});

export type InsertComputer = z.infer<typeof insertComputerSchema>;
export type Computer = typeof computers.$inferSelect;
