import Link from "next/link";
import { getMovies } from "../lib/api";

export default async function MoviesPage() {
  const movies = await getMovies();

  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">THE FILM GUIDE</p>
        <h1>Find your next film.</h1>
        <p>Explore the stories. Check the showtimes.</p>
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
    </>
  );
}
