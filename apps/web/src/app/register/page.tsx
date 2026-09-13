import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/auth-form";
import { getCurrentUser } from "../../lib/auth";
import { safeReturnTo } from "../../lib/return-to";

export const metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (await getCurrentUser()) redirect(returnTo);
  return (
    <section className="auth-panel notice">
      <p className="eyebrow">YOUR FAIRGATE ACCOUNT</p>
      <h1>Make yourself at home</h1>
      <p>Create an account for the FairGate cinema demo.</p>
      <AuthForm mode="register" returnTo={returnTo} />
      <p className="auth-switch">Already registered? <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></p>
    </section>
  );
}
