import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { getCurrentUser } from "../../lib/auth";
import { safeReturnTo } from "../../lib/return-to";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (await getCurrentUser()) redirect(returnTo);
  return (
    <section className="auth-panel notice">
      <p className="eyebrow">YOUR FAIRGATE ACCOUNT</p>
      <h1>Welcome back</h1>
      <p>Sign in to your cinema account.</p>
      <AuthForm mode="login" returnTo={returnTo} />
      <p className="auth-switch">New here? <Link href={`/register?returnTo=${encodeURIComponent(returnTo)}`}>Create an account</Link></p>
    </section>
  );
}
