import { createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import { prisma } from "../db.js";

export const publicUserFields = { id: true, name: true, email: true } as const;

export function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newSession() {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return { token, tokenHash: tokenDigest(token), expiresAt };
}

export function bearerToken(request: Request) {
  return request.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1] ?? null;
}

export async function currentUser(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenDigest(token) },
    select: { expiresAt: true, user: { select: publicUserFields } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}
