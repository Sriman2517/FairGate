import Link from "next/link";
import { getMovies } from "../lib/api";

export default async function MoviesPage() {
  const movies = await getMovies();

  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">THE FILM GUIDE</p>
        <h1>Find your next film.</h1>
        <p>Find a showtime, join the waiting room, and book a seat when it’s your turn.</p>
      </div>
      {movies.length === 0 ? (
        <section className="notice">
          <h2>No movies listed yet</h2>
          <p>Please check back later for new listings.</p>
        </section>
      ) : (
        <ul className="movie-grid" aria-label="Movies">
          {movies.map((movie) => (
            <li className="movie-card" key={movie.id}>
              <p className="movie-meta">{movie.language} · {movie.durationMinutes} min</p>
              <h2>{movie.title}</h2>
              <p className="synopsis">{movie.synopsis}</p>
              <Link className="button" href={`/movies/${movie.id}`} aria-label={`View showtimes for ${movie.title}`}>
                View showtimes <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <section className="booking-guide" aria-labelledby="booking-guide-heading">
        <div className="section-heading"><h2 id="booking-guide-heading">From showtime to your seat</h2></div>
        <ol className="booking-steps">
          <li><h3>Join the waiting room</h3><p>Sign in and join your show’s line. Keep the page open to keep your place.</p></li>
          <li><h3>Choose your seat</h3><p>When your turn opens, you have up to two minutes to choose and confirm one seat.</p></li>
          <li><h3>Find your ticket</h3><p>Your confirmation is saved in My bookings. This is a demo; no payment is collected.</p></li>
        </ol>
        <p className="field-help">A place in line or a selected seat is not a reservation. Your seat is yours once the booking is confirmed.</p>
      </section>
    </>
  );
}
