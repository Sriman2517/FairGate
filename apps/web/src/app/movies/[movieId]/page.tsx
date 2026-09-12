import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMovie, getShows } from "../../../lib/api";

export const metadata: Metadata = { title: "Movie showtimes" };

const showDateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const ticketPrice = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export default async function MoviePage({
  params,
}: {
  params: Promise<{ movieId: string }>;
}) {
  const { movieId } = await params;
  const movie = await getMovie(movieId);

  if (!movie) {
    notFound();
  }

  const shows = await getShows(movie.id);

  return (
    <>
      <Link className="back-link" href="/">← All movies</Link>
      <div className="page-heading movie-heading">
        <p className="eyebrow">{movie.language} · {movie.durationMinutes} min</p>
        <h1>{movie.title}</h1>
        <p>{movie.synopsis}</p>
      </div>
      <section aria-labelledby="showtimes-heading">
        <div className="section-heading">
          <h2 id="showtimes-heading">Showtimes</h2>
          <p>All times in India Standard Time (IST)</p>
        </div>
        {shows.length === 0 ? (
          <div className="notice">
            <h3>No shows scheduled yet</h3>
            <p>This film is in the catalogue. Check back later for showtimes.</p>
          </div>
        ) : (
          <ul className="show-list" aria-label="Showtimes">
            {shows.map((show) => (
              <li className="show-row" key={show.id}>
                <div>
                  <h3>{show.cinemaName}</h3>
                  <p className="screen-name">{show.screenName}</p>
                  <time dateTime={show.startsAt}>{showDateTime.format(new Date(show.startsAt))}</time>
                </div>
                <p className="ticket-price">
                  {ticketPrice.format(show.priceInPaise / 100)}
                  <span>per ticket</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
