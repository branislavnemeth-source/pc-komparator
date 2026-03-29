import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { computers } from "@shared/schema";
import type { Computer, InsertComputer } from "@shared/schema";
import { eq } from "drizzle-orm";

const sqlite = new Database("data.db");
export const db = drizzle(sqlite);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS computers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    name TEXT,
    brand TEXT,
    price TEXT,
    price_numeric INTEGER,
    currency TEXT,
    processor TEXT,
    ram TEXT,
    storage TEXT,
    gpu TEXT,
    display TEXT,
    os TEXT,
    weight TEXT,
    battery TEXT,
    image_url TEXT,
    eshop_name TEXT,
    availability TEXT,
    raw_data TEXT,
    session_id TEXT NOT NULL,
    fetched_at TEXT
  )
`);

export interface IStorage {
  saveComputer(data: InsertComputer): Computer;
  getComputersBySession(sessionId: string): Computer[];
  deleteComputersBySession(sessionId: string): void;
}

export class Storage implements IStorage {
  saveComputer(data: InsertComputer): Computer {
    return db.insert(computers).values(data).returning().get();
  }

  getComputersBySession(sessionId: string): Computer[] {
    return db.select().from(computers).where(eq(computers.sessionId, sessionId)).all();
  }

  deleteComputersBySession(sessionId: string): void {
    db.delete(computers).where(eq(computers.sessionId, sessionId)).run();
  }
}

export const storage = new Storage();
