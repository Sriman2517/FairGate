import { createHash } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { bearerToken, currentUser, newSession, publicUserFields, tokenDigest } from "../auth/sessions.js";
import { readCredentials, readRegistration } from "../auth/validation.js";

export const authRouter = Router();

const limitOptions = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts. Please try again later." } },
};

// Next.js shares one backend IP. This is a coarse process-local safeguard,
// not a visitor-specific or distributed rate limiter.
const authAttempts = rateLimit({ ...limitOptions, limit: 60 });
const accountAttempts = rateLimit({
  ...limitOptions,
  limit: 10,
  keyGenerator: (request) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    return createHash("sha256").update(email).digest("hex");
  },
});

authRouter.post("/register", authAttempts, async (request, response) => {
  const input = readRegistration(request.body);
  if (!input) {
    response.status(400).json({ error: { code: "INVALID_INPUT", message: "Use a name of 1–80 characters, a valid email, and a password of 15–128 characters." } });
    return;
  }

  const passwordHash = await hashPassword(input.password);
  const session = newSession();
  try {
    // The nested write creates the customer and their first session atomically.
    const user = await prisma.user.create({
      data: {
        name: input.name, email: input.email, passwordHash,
        sessions: { create: { tokenHash: session.tokenHash, expiresAt: session.expiresAt } },
      },
      select: publicUserFields,
    });
    response.status(201).json({ user, session: { token: session.token, expiresAt: session.expiresAt } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: { code: "EMAIL_IN_USE", message: "An account already uses that email. Sign in instead." } });
      return;
    }
    throw error;
  }
});

authRouter.post("/login", authAttempts, accountAttempts, async (request, response) => {
  const input = readCredentials(request.body);
  if (!input) {
    response.status(400).json({ error: { code: "INVALID_INPUT", message: "Enter a valid email and password." } });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const validPassword = await verifyPassword(input.password, user?.passwordHash ?? null);
  if (!user || !validPassword) {
    response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
    return;
  }

  const session = newSession();
  await prisma.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
  response.status(200).json({
    user: { id: user.id, name: user.name, email: user.email },
    session: { token: session.token, expiresAt: session.expiresAt },
  });
});

authRouter.get("/me", async (request, response) => {
  const user = await currentUser(request);
  if (!user) {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    return;
  }
  response.status(200).json({ user });
});

authRouter.post("/logout", async (request, response) => {
  const token = bearerToken(request);
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenDigest(token) } });
  response.status(204).end();
});
