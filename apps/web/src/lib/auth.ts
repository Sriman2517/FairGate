import "server-only";
import { cookies } from "next/headers";
import { apiRequest } from "./api-request";

export interface Customer {
  id: string;
  name: string;
  email: string;
}

export interface AuthResult {
  user: Customer;
  session: { token: string; expiresAt: string };
}

export const sessionCookie = "fairgate_session";

// Only the Next.js server calls this helper; the token never becomes a client prop.
export function authRequest(path: string, options: RequestInit = {}) {
  return apiRequest(`/auth/${path}`, options);
}

export async function getCurrentUser(): Promise<Customer | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;

  const response = await authRequest("me", { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Could not load the current account.");
  const data: { user: Customer } = await response.json();
  return data.user;
}
