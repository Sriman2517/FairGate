import { Router } from "express";
import { currentUser } from "../auth/sessions.js";
import { prisma } from "../db.js";
import { getOperationsSnapshot } from "../operations.js";

export const operationsRouter = Router();

operationsRouter.get("/shows", async (request, response) => {
  const user = await currentUser(request);
  if (!user) {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    return;
  }
  // Read the role fresh, not from a cookie or a role cached when signing in.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (account?.role !== "OPERATOR") {
    response.status(403).json({ error: { code: "OPERATOR_REQUIRED", message: "This page is for FairGate operators." } });
    return;
  }
  response.json(await getOperationsSnapshot());
});
