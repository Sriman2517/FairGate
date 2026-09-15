import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WaitingRoom } from "../../../components/waiting-room";
import { MoviePoster } from "../../../components/movie-poster";
import { BookTicketsButton } from "../../../components/book-tickets-button";
import { getCurrentUser } from "../../../lib/auth";
import { getShow } from "../../../lib/bookings";
import { readWaitingRoom } from "../../../lib/waiting-room";
import { formatPrice, formatShowTime } from "../../../lib/format";

export const metadata = { title: "Choose your seats" };
export default async function ShowPage({ params, searchParams }: {
  params: Promise<{ showId: string }>; searchParams: Promise<{ entry?: string }>;
}) {
  const { showId } = await params;
  const data = await getShow(showId);
  if (!data) notFound();
  const { show, seats } = data;
  const user = await getCurrentUser();
  const started = new Date(show.startsAt).getTime() <= Date.now();
  const availableCount = seats.filter((seat) => seat.available).length;
  // Viewing/prefetching this page never joins the line.
  const waitingRoom = user && !started && availableCount > 0 ? await readWaitingRoom(showId) : undefined;
  const entryFailed = (await searchParams).entry === "unavailable";
  return <>
    <Link className="back-link" href={`/movies/${show.movieId}`}>← All showtimes</Link>
    <div className="checkout-heading"><div className="checkout-poster"><MoviePoster title={show.movieTitle} path={show.posterPath} /></div>
      <div><p className="eyebrow">YOUR MOVIE NIGHT</p><h1>{show.movieTitle}</h1><p>{show.cinemaName} · {show.screenName}</p><p><time dateTime={show.startsAt}>{formatShowTime(show.startsAt)}</time> (IST)</p></div>
    </div>
    <section className="notice seating-panel" aria-labelledby="seating-heading">
      <div className="section-heading"><div><p className="eyebrow">THE BEST SEAT IS YOURS</p><h2 id="seating-heading">Settle into your seats</h2></div><p>{availableCount} available · {formatPrice(show.priceInPaise)} each</p></div>
      <p className="demo-booking-note">Demo tickets · Up to 6 seats per booking · No payment</p>
      {entryFailed && waitingRoom?.waitingRoom?.status !== "admitted" && waitingRoom?.waitingRoom?.status !== "waiting" && <p className="form-error" role="alert">We couldn’t add you to checkout. The waiting room may be full or temporarily unavailable. Please try Book tickets again shortly.</p>}
      {user && !started && availableCount > 0 ? <WaitingRoom key={show.id} showId={show.id} movieId={show.movieId} seats={seats}
        priceInPaise={show.priceInPaise} initialRequestId={randomUUID()} initialResult={waitingRoom!} /> : <div className="booking-empty">
        <div className="cinema-screen">ALL EYES THIS WAY</div>
        <div className="seat-map-scroll" role="region" aria-label="Seat availability preview" tabIndex={0}><div className="seat-grid">{seats.map((seat) => <span key={seat.label} className={seat.available ? "seat" : "seat seat-booked"} aria-label={`Seat ${seat.label}, ${seat.available ? "available" : "booked"}`}>{seat.label}</span>)}</div></div>
        {started ? <p>This show has started. Booking is closed.</p> : availableCount === 0 ? <p>This show is sold out. Choose another showtime.</p> : <><p>Sign in to choose seats for your group.</p><BookTicketsButton showId={show.id} /></>}
        {(started || availableCount === 0) && <Link className="button" href={`/movies/${show.movieId}`}>Choose another showtime</Link>}
      </div>}
    </section>
  </>;
}
