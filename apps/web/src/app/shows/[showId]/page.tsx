import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WaitingRoom } from "../../../components/waiting-room";
import { getCurrentUser } from "../../../lib/auth";
import { getShow } from "../../../lib/bookings";
import { readWaitingRoom } from "../../../lib/waiting-room";
import { formatPrice, formatShowTime } from "../../../lib/format";

export const metadata = { title: "Choose a seat" };

export default async function ShowPage({ params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const data = await getShow(showId);
  if (!data) notFound();
  const { show, seats } = data;
  const user = await getCurrentUser();
  const started = new Date(show.startsAt).getTime() <= Date.now();
  const availableCount = seats.filter((seat) => seat.available).length;
  const waitingRoom = user && !started && availableCount > 0 ? await readWaitingRoom(showId) : undefined;

  return (
    <>
      <Link className="back-link" href={`/movies/${encodeURIComponent(show.movieId)}`}>← All showtimes</Link>
      <div className="page-heading movie-heading">
        <p className="eyebrow">CHOOSE YOUR SEAT</p>
        <h1>{show.movieTitle}</h1>
        <p>{show.cinemaName} · {show.screenName}<br />
          <time dateTime={show.startsAt}>{formatShowTime(show.startsAt)}</time> (IST)
        </p>
      </div>
      <section className="notice seating-panel" aria-labelledby="seating-heading">
        <div className="section-heading">
          <h2 id="seating-heading">Your seat, your show</h2>
          <p>{availableCount} of {seats.length} seats available · {formatPrice(show.priceInPaise)} each</p>
        </div>
        <p className="demo-booking-note">Demo bookings only. No payment is collected.</p>
        <div className="cinema-screen" aria-label="Cinema screen at the front">SCREEN</div>
        {user && !started && availableCount > 0 ? (
          <WaitingRoom key={show.id} showId={show.id} seats={seats} price={formatPrice(show.priceInPaise)}
            initialRequestId={randomUUID()} initialResult={waitingRoom!} />
        ) : (
          <>
            <div className="seat-grid" aria-label="Seat availability">
              {seats.map((seat) => <span key={seat.label} className={seat.available ? "seat" : "seat seat-booked"}
                aria-label={`Seat ${seat.label}, ${seat.available ? "available" : "booked"}`}>{seat.label}</span>)}
            </div>
            <p className="seat-legend"><span>□ Available</span><span>× Booked</span></p>
            {started ? <p className="booking-status">This show has started. Booking is closed.</p>
              : seats.length === 0 ? <p className="booking-status">Seat selection is not available for this show yet.</p>
              : availableCount === 0 ? <p className="booking-status">This show is sold out. Please choose another showtime.</p>
              : <p className="booking-status"><Link className="button" href={`/login?returnTo=${encodeURIComponent(`/shows/${show.id}`)}`}>Sign in to choose a seat</Link></p>}
          </>
        )}
      </section>
    </>
  );
}
