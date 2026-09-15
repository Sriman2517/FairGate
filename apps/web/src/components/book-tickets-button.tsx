"use client";

import { useFormStatus } from "react-dom";
import { beginBooking } from "../app/actions/waiting-room";

function Submit() {
  const { pending } = useFormStatus();
  return <button className="button" disabled={pending}>{pending ? "Opening booking…" : "Book tickets"}<span aria-hidden="true">↗</span></button>;
}
export function BookTicketsButton({ showId }: { showId: string }) {
  return <form action={beginBooking}><input type="hidden" name="showId" value={showId} /><Submit /></form>;
}
