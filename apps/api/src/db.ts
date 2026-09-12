import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Set it in apps/api/.env before starting the API.");
}

const adapter = new PrismaPg({
  connectionString,
  connectionTimeoutMillis: 3000,
});

// One client and connection pool per API process, shared by all route handlers.
export const prisma = new PrismaClient({ adapter });
