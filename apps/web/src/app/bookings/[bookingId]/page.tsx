import { MoviePoster } from "../../../components/movie-poster";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthenticationRequired, getBooking, type Booking } from "../../../lib/bookings";
import { formatPrice, formatShowTime } from "../../../lib/format";

export const metadata = { title: "Your booking" };

export default async function BookingPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  let booking: Booking | null;
  try {
    booking = await getBooking(bookingId);
  } catch (error) {
    if (error instanceof AuthenticationRequired) redirect("/login?returnTo=%2Fbookings");
    throw error;
  }
  if (!booking) notFound();

  return (
    <>
      <Link className="back-link" href="/bookings">← My bookings</Link>
      <section className="notice booking-ticket">
        <div className="confirmation-mark" aria-hidden="true">✓</div><p className="eyebrow">YOU’RE ALL SET · DEMO BOOKING CONFIRMED</p><div className="ticket-poster"><MoviePoster title={booking.show.movieTitle} path={booking.show.posterPath} /></div>
        <h1>{booking.show.movieTitle}</h1>
        <p>Your seats are confirmed. Find this ticket anytime in My bookings. No payment was collected.</p>
        <dl className="booking-details">
          <div><dt>Seats ({booking.seatLabels.length})</dt><dd className="ticket-seat">{booking.seatLabels.join(", ")}</dd></div>
          <div><dt>Total amount</dt><dd>{formatPrice(booking.priceInPaise)}</dd></div>
          <div><dt>Cinema</dt><dd>{booking.show.cinemaName} · {booking.show.screenName}</dd></div>
          <div><dt>Showtime</dt><dd><time dateTime={booking.show.startsAt}>{formatShowTime(booking.show.startsAt)}</time> (IST)</dd></div>
          <div><dt>Booking reference</dt><dd className="booking-reference">{booking.id}</dd></div>
        </dl>
        <ul className="ticket-items" aria-label="Ticket breakdown">{booking.seats.map((seat) => <li key={seat.seatLabel}><span>Seat {seat.seatLabel}</span><strong>{formatPrice(seat.priceInPaise)}</strong></li>)}</ul><Link className="button" href="/">Browse more movies</Link>
      </section>
    </>
  );
}
