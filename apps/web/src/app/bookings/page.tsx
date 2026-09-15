import { MoviePoster } from "../../components/movie-poster";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthenticationRequired, getBookings, type Booking } from "../../lib/bookings";
import { formatPrice, formatShowTime } from "../../lib/format";

export const metadata = { title: "My bookings" };

export default async function BookingsPage() {
  let bookings: Booking[];
  try {
    bookings = await getBookings();
  } catch (error) {
    if (error instanceof AuthenticationRequired) redirect("/login?returnTo=%2Fbookings");
    throw error;
  }

  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR FAIRGATE ACCOUNT</p>
        <h1>My bookings</h1>
        <p>Your confirmed demo tickets. No payment was collected.</p>
      </div>
      {bookings.length === 0 ? (
        <section className="notice">
          <h2>No bookings yet</h2>
          <p>Find a film, choose a showtime, and book your first demo seat.</p>
          <p><Link href="/">Browse movies</Link></p>
        </section>
      ) : (
        <ul className="show-list" aria-label="Your bookings">
          {bookings.map((booking) => (
            <li className="show-row" key={booking.id}>
              <div className="booking-list-film"><div className="booking-list-poster"><MoviePoster title={booking.show.movieTitle} path={booking.show.posterPath} /></div><div>
                <h2 className="booking-movie-title">{booking.show.movieTitle}</h2>
                <p className="screen-name">{booking.show.cinemaName} · {booking.show.screenName} · Seats {booking.seatLabels.join(", ")}</p>
                <p><time dateTime={booking.show.startsAt}>{formatShowTime(booking.show.startsAt)}</time> (IST)</p></div>
              </div>
              <div className="show-booking-link">
                <p className="ticket-price">{formatPrice(booking.priceInPaise)}<span>total demo amount</span></p>
                <Link href={`/bookings/${encodeURIComponent(booking.id)}`}>View booking</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
