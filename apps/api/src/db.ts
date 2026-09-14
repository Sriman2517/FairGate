import { readApiConfig } from "./config.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString = readApiConfig().databaseUrl;

const adapter = new PrismaPg({
  connectionString,
  connectionTimeoutMillis: 3000,
  max: 10,
  statement_timeout: 3000,
  query_timeout: 4000,
});

// One client and connection pool per API process, shared by all route handlers.
export const prisma = new PrismaClient({ adapter });
