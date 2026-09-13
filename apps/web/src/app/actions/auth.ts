"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRequest, sessionCookie, type AuthResult } from "../../lib/auth";
import { safeReturnTo } from "../../lib/return-to";

export type AuthState = { error: string };

async function authenticate(kind: "register" | "login", formData: FormData): Promise<AuthState> {
  // Pick fields explicitly. Validation and identity ownership belong to the API.
  const input = {
    email: formData.get("email"),
    password: formData.get("password"),
    ...(kind === "register" ? { name: formData.get("name") } : {}),
  };

  try {
    const response = await authRequest(kind, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      if ([400, 401, 409, 429].includes(response.status)) {
        const data: { error: { message: string } } = await response.json();
        return { error: data.error.message };
      }
      return { error: "We could not sign you in. Please try again shortly." };
    }

    const data: AuthResult = await response.json();
    (await cookies()).set(sessionCookie, data.session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(data.session.expiresAt),
    });
  } catch {
    return { error: "The account service is unavailable. Please try again shortly." };
  }

  // redirect() throws a Next.js control-flow signal, so keep it outside the catch.
  redirect(safeReturnTo(formData.get("returnTo")));
}

export async function register(_previousState: AuthState, formData: FormData): Promise<AuthState> {
  return authenticate("register", formData);
}

export async function login(_previousState: AuthState, formData: FormData): Promise<AuthState> {
  return authenticate("login", formData);
}

export async function logout(_previousState: AuthState, _formData: FormData): Promise<AuthState> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookie)?.value;
  if (token) {
    try {
      const response = await authRequest("logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Session revocation failed.");
    } catch {
      // Keep the cookie so the customer can retry revoking this session.
      return { error: "We could not sign you out. Please try again shortly." };
    }
  }

  cookieStore.delete(sessionCookie);
  redirect("/login");
}
