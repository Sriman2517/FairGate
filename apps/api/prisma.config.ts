import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Managed pools are for application traffic; migrations can use a direct URL.
    url: process.env.DIRECT_DATABASE_URL ?? env("DATABASE_URL"),
  },
});
