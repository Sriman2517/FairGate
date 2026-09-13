import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutForm } from "../../components/auth-form";
import { getCurrentUser } from "../../lib/auth";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <section className="auth-panel notice">
      <p className="eyebrow">YOUR FAIRGATE ACCOUNT</p>
      <h1>Welcome, {user.name}</h1>
      <dl className="account-details">
        <dt>Email</dt>
        <dd>{user.email}</dd>
      </dl>
      <p>You’re signed in. Choose a film or revisit your demo tickets.</p>
      <p><Link href="/bookings">My bookings</Link></p>
      <p><Link href="/">Browse movies</Link></p>
      <LogoutForm />
    </section>
  );
}
