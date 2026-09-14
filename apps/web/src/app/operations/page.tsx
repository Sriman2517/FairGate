import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthenticationRequired } from "../../lib/bookings";
import { formatShowTime } from "../../lib/format";
import { getOperations } from "../../lib/operations";

const observedTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" });

export const metadata = { title: "Operations" };

export default async function OperationsPage() {
  const snapshot = await getOperations().catch((error: unknown) => {
    if (error instanceof AuthenticationRequired) redirect("/login?returnTo=%2Foperations");
    throw error;
  });
  if (!snapshot) return (
    <section className="notice page-notice">
      <p className="eyebrow">OPERATOR ACCESS</p>
      <h1>This page is for FairGate operators</h1>
      <p>Your account does not have access to show operations.</p>
      <Link className="back-link" href="/">Browse movies</Link>
    </section>
  );

  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow">FAIRGATE OPERATIONS</p>
        <h1>Shows at a glance</h1>
        <p>Seat inventory and checkout activity for upcoming shows.</p>
      </div>
      <div className="operations-toolbar">
        <div>
          <p>Inventory snapshot: <time dateTime={snapshot.inventoryObservedAt}>{observedTime.format(new Date(snapshot.inventoryObservedAt))} IST</time></p>
          {snapshot.queueObservedAt && <p>Queue snapshot: <time dateTime={snapshot.queueObservedAt}>{observedTime.format(new Date(snapshot.queueObservedAt))} IST</time></p>}
          <p>Refresh for the latest counts. This page does not advance the waiting room.</p>
        </div>
        <form action="/operations" method="get"><button className="button" type="submit">Refresh snapshot</button></form>
      </div>
      {snapshot.queueStatus === "unavailable" && <p className="form-error" role="status">Queue counts are temporarily unavailable. Seat inventory is available; unknown counts do not mean zero customers.</p>}
      {snapshot.hasMore && <p className="operations-note">Showing the next {snapshot.limit} shows. Later shows are outside this snapshot.</p>}
      {snapshot.shows.length === 0 ? <div className="notice"><h2>No upcoming shows</h2><p>Scheduled shows will appear here.</p></div> : (
        <div className="operations-table-wrap" role="region" aria-label="Show operations" tabIndex={0}>
          <table className="operations-table">
            <caption>Upcoming shows · times in IST</caption>
            <thead><tr><th scope="col">Show</th><th scope="col">Available seats</th><th scope="col">Booked seats</th><th scope="col">Total seats</th><th scope="col">Waiting customers</th><th scope="col">Active turns / capacity</th></tr></thead>
            <tbody>{snapshot.shows.map((show) => (
              <tr key={show.id}>
                <th scope="row"><Link href={`/shows/${encodeURIComponent(show.id)}`}>{show.movieTitle}</Link><span>{show.cinemaName} · {show.screenName}</span><time dateTime={show.startsAt}>{formatShowTime(show.startsAt)}</time></th>
                <td>{show.availableSeats}</td><td>{show.bookedSeats}</td><td>{show.totalSeats}</td>
                <td>{show.waitingCustomers ?? "Unknown"}</td><td>{show.activeTurns ?? "Unknown"} / {show.checkoutCapacity}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="operations-note">An active turn allows checkout access; it does not hold a seat and can remain active after a booking. Inventory and queue counts are separate snapshots.</p>
      <Link className="back-link" href="/account">Your account</Link>
    </section>
  );
}
