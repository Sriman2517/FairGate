export function readCredentials(body: unknown, registering = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;

  const normalizedEmail = email.trim().toLowerCase();
  const passwordLength = [...password].length;
  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    passwordLength < (registering ? 15 : 1) || passwordLength > 128
  ) return null;

  return { email: normalizedEmail, password };
}

export function readRegistration(body: unknown) {
  const credentials = readCredentials(body, true);
  if (!credentials) return null;
  const { name } = body as Record<string, unknown>;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80) return null;
  return { ...credentials, name: name.trim() };
}
