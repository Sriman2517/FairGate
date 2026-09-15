import Link from "next/link";
import { notFound } from "next/navigation";
import { getMovie, getShows } from "../../../lib/api";
import { formatPrice, formatShowTime } from "../../../lib/format";
import { MoviePoster } from "../../../components/movie-poster";
import { BookTicketsButton } from "../../../components/book-tickets-button";

export const metadata = { title: "Movie showtimes" };
export default async function MoviePage({ params }: { params: Promise<{ movieId: string }> }) {
  const { movieId } = await params;
  const movie = await getMovie(movieId);
  if (!movie) notFound();
  const shows = await getShows(movie.id);
  return <>
    <Link className="back-link" href="/">← All movies</Link>
    <section className="movie-feature">
      <MoviePoster title={movie.title} path={movie.posterPath} priority />
      <div className="movie-feature-copy"><p className="eyebrow">THE BIG SCREEN COLLECTION</p><h1>{movie.title}</h1>
        <p className="feature-meta">{movie.language} · {movie.durationMinutes} min · {movie.genre ?? "Cinema"}</p>
        <p>{movie.synopsis}</p><a className="button" href="#showtimes">Choose a showtime ↓</a>
        <p className="feature-note">Demo screenings. Real movie magic.</p>
      </div>
    </section>
    <section id="showtimes" aria-labelledby="showtimes-heading">
      <div className="section-heading"><div><p className="eyebrow">SAVE THE DATE</p><h2 id="showtimes-heading">Choose your showtime</h2></div><p>All times in IST · No payment required</p></div>
      {!shows.length ? <div className="notice"><h3>No shows scheduled yet</h3><p>Check back later for showtimes.</p></div> :
        <ul className="show-list" aria-label="Showtimes">{shows.map((show) => <li className="show-row" key={show.id}>
          <div><span className="cinema-label">FAIRGATE SCREENINGS</span><h3>{show.cinemaName}</h3><p className="screen-name">{show.screenName} · Reserved seating</p><time dateTime={show.startsAt}>{formatShowTime(show.startsAt)}</time></div>
          <div className="show-booking-link"><p className="ticket-price">{formatPrice(show.priceInPaise)}<span>per ticket</span></p>
            {new Date(show.startsAt).getTime() <= Date.now() ? <Link className="button button-secondary" href={`/shows/${show.id}`}>View closed show</Link> : <BookTicketsButton showId={show.id} />}
          </div>
        </li>)}</ul>}
    </section>
  </>;
}
