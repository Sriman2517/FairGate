"use client";

import { useActionState } from "react";
import { login, logout, register } from "../app/actions/auth";

export function AuthForm({ mode, returnTo = "/account" }: { mode: "register" | "login"; returnTo?: string }) {
  const isRegistration = mode === "register";
  const [state, action, pending] = useActionState(isRegistration ? register : login, { error: "" });

  return (
    <form className="auth-form" action={action}>
      <input type="hidden" name="returnTo" value={returnTo} />
      {isRegistration && (
        <label>
          Name
          <input name="name" autoComplete="name" required maxLength={80} />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete={isRegistration ? "new-password" : "current-password"}
          required minLength={isRegistration ? 15 : undefined} maxLength={128}
          aria-describedby={isRegistration ? "password-help" : undefined} />
      </label>
      {isRegistration && <p id="password-help" className="field-help">Use 15–128 characters. A long passphrase works well.</p>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Please wait…" : isRegistration ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}

export function LogoutForm() {
  const [state, action, pending] = useActionState(logout, { error: "" });
  return (
    <form className="auth-form" action={action}>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="button" type="submit" disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>
    </form>
  );
}
