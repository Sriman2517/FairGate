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
        <p className="eyebrow">DEMO BOOKING CONFIRMED</p>
        <h1>{booking.show.movieTitle}</h1>
        <p>Your seat is booked. This is a demo ticket; no payment was collected.</p>
        <dl className="booking-details">
          <div><dt>Seat</dt><dd className="ticket-seat">{booking.seatLabel}</dd></div>
          <div><dt>Ticket amount</dt><dd>{formatPrice(booking.priceInPaise)}</dd></div>
          <div><dt>Cinema</dt><dd>{booking.show.cinemaName} · {booking.show.screenName}</dd></div>
          <div><dt>Showtime</dt><dd><time dateTime={booking.show.startsAt}>{formatShowTime(booking.show.startsAt)}</time> (IST)</dd></div>
          <div><dt>Booking reference</dt><dd className="booking-reference">{booking.id}</dd></div>
        </dl>
        <Link href="/">Browse more movies</Link>
      </section>
    </>
  );
}
