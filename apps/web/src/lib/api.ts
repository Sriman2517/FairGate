import "server-only";

// These describe the API's JSON contract, not runtime validation.
export interface Movie {
  id: string;
  title: string;
  synopsis: string;
  language: string;
  durationMinutes: number;
}

export interface Show {
  id: string;
  movieId: string;
  cinemaName: string;
  screenName: string;
  startsAt: string;
  priceInPaise: number;
  currency: "INR";
}

const apiUrl = process.env.FAIRGATE_API_URL ?? "http://127.0.0.1:4000";

function request(path: string) {
  return fetch(new URL(path, apiUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
}

export async function getMovies(): Promise<Movie[]> {
  const response = await request("/movies");
  if (!response.ok) {
    throw new Error(`Could not load movies: HTTP ${response.status}`);
  }

  const data: { movies: Movie[] } = await response.json();
  return data.movies;
}

export async function getMovie(movieId: string): Promise<Movie | null> {
  const response = await request(`/movies/${encodeURIComponent(movieId)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Could not load movie: HTTP ${response.status}`);
  }

  const data: { movie: Movie } = await response.json();
  return data.movie;
}

export async function getShows(movieId: string): Promise<Show[]> {
  const response = await request(`/movies/${encodeURIComponent(movieId)}/shows`);
  if (!response.ok) {
    throw new Error(`Could not load shows: HTTP ${response.status}`);
  }

  const data: { shows: Show[] } = await response.json();
  return data.shows;
}
