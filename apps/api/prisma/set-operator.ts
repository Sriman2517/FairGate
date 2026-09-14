import "dotenv/config";
import { parseArgs } from "node:util";

// Local bootstrap only. There is deliberately no public role-changing endpoint.
async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, role: { type: "string" } }, allowPositionals: false });
  const email = values.email?.trim().toLowerCase();
  const role = values.role;
  if (!email || (role !== "OPERATOR" && role !== "CUSTOMER")) {
    throw new Error("Usage: npm run operator:set -- --email <existing-email> --role OPERATOR|CUSTOMER");
  }
  const database = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" ||
    database.port !== "5433" || database.pathname !== "/fairgate") {
    throw new Error("Role changes require the local database at 127.0.0.1:5433/fairgate.");
  }
  const { prisma } = await import("../src/db.js");
  try {
    const result = await prisma.user.updateMany({ where: { email }, data: { role } });
    if (result.count !== 1) throw new Error("No account found. Register the intended account first.");
    console.log(`Account role is now ${role}. Existing sessions use this role on their next operator request.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Do not print a connection string, query arguments, or credentials on failure.
  console.error(error instanceof Error && !error.name.startsWith("Prisma") ? error.message : "Role change failed. Check the local database and migrations.");
  process.exitCode = 1;
});
