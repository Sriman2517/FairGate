import { argon2id, hash, verify } from "argon2";

export function hashPassword(password: string) {
  return hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

// Unknown accounts still perform password verification rather than exiting early.
// This is not an account password; it only supplies a valid Argon2 hash.
const dummyHash = await hashPassword("FairGate missing-account verification value");

export function verifyPassword(password: string, passwordHash: string | null) {
  return verify(passwordHash ?? dummyHash, password);
}
