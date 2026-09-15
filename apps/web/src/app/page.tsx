import Link from "next/link";
import { getMovies } from "../lib/api";
import { MoviePoster } from "../components/movie-poster";

export default async function MoviesPage() {
  const allMovies = await getMovies();
  const featured = allMovies.filter((movie) => movie.featured);
  const movies = featured.length ? featured : allMovies;
  const hero = movies.find((movie) => movie.id === "interstellar") ?? movies[0];
  return <>
    {hero && <section className="cinema-hero" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <p className="eyebrow">THE BIG SCREEN COLLECTION</p>
        <h1 id="hero-heading">Some stories deserve<br /><em>a bigger screen.</em></h1>
        <p>A little escape. A great film. Your favourite seats.<br />Make your next movie night one to remember.</p>
        <Link className="button" href={`/movies/${hero.id}`}>Explore {hero.title}<span aria-hidden="true">↗</span></Link>
        <span className="hero-caption">SPECIAL SCREENINGS · FAIRGATE DEMO CINEMA</span>
      </div>
      <div className="hero-poster"><MoviePoster title={hero.title} path={hero.posterPath} priority /></div>
    </section>}
    <section className="catalogue" aria-labelledby="movies-heading">
      <div className="section-heading"><div><p className="eyebrow">PLAN YOUR MOVIE NIGHT</p><h2 id="movies-heading">Back on the big screen</h2></div><p>Curated films · Demo screenings</p></div>
      {!movies.length ? <div className="notice"><h3>No films listed yet</h3><p>Check back for new showtimes.</p></div> :
        <ul className="movie-grid">{movies.map((movie) => <li className="movie-card" key={movie.id}>
          <Link className="poster-link" href={`/movies/${movie.id}`} aria-label={`Explore ${movie.title}`}><MoviePoster title={movie.title} path={movie.posterPath} /><span className="poster-badge">SPECIAL SCREENING</span></Link>
          <div className="movie-card-copy"><p className="movie-meta">{movie.language} <span aria-hidden="true">/</span> {movie.durationMinutes} min</p><h3>{movie.title}</h3><p className="genre">{movie.genre ?? "Cinema"}</p>
            <Link className="movie-action" href={`/movies/${movie.id}`} aria-label={`View showtimes for ${movie.title}`}>View showtimes <span aria-hidden="true">↗</span></Link>
          </div>
        </li>)}</ul>}
    </section>
    <section className="booking-guide" aria-labelledby="booking-guide-heading">
      <div className="section-heading"><div><p className="eyebrow">LESS WAITING. MORE MOVIE.</p><h2 id="booking-guide-heading">Your movie night, in three steps.</h2></div></div>
      <ol className="booking-steps">
        <li><h3>Find your show</h3><p>Pick a film and click Book tickets for your preferred showtime.</p></li>
        <li><h3>Make room for everyone</h3><p>Choose up to 6 seats together. If checkout is busy, we’ll keep your place in line.</p></li>
        <li><h3>You’re all set</h3><p>One confirmation for your whole group, saved in My bookings.</p></li>
      </ol>
      <p className="field-help">A place in line or a seat selection is not a reservation. Your seats are yours once confirmed. No payment is collected.</p>
    </section>
  </>;
}
