export interface Movie {
  id: string;
  title: string;
  synopsis: string;
  language: string;
  durationMinutes: number;
  posterPath?: string;
  genre?: string;
  featured?: boolean;
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

// Real films with fictional demo screenings. Legacy films remain for existing tickets.
export const movies: Movie[] = [
  { id: "rrr", title: "RRR", language: "Telugu", durationMinutes: 182, genre: "Action · Drama", featured: true, posterPath: "/posters/rrr.jpg", synopsis: "Two men on opposing missions form an extraordinary friendship in a story of courage, loyalty and rebellion." },
  { id: "interstellar", title: "Interstellar", language: "English", durationMinutes: 169, genre: "Sci-fi · Adventure", featured: true, posterPath: "/posters/interstellar.jpg", synopsis: "A pilot leaves his family behind to search beyond our solar system for a future for humanity." },
  { id: "dune-part-two", title: "Dune: Part Two", language: "English", durationMinutes: 166, genre: "Sci-fi · Adventure", featured: true, posterPath: "/posters/dune-part-two.jpg", synopsis: "On the desert world of Arrakis, Paul Atreides joins the Fremen as love, revenge and the weight of prophecy collide." },
];

// Fixed UTC times for the demo; a listed show does not imply seat availability.
export const shows: Show[] = [
  ...["rrr", "interstellar", "dune-part-two"].flatMap((movieId, index) => [
    { id: `${movieId}-matinee`, movieId, cinemaName: "FairGate Demo Cinema", screenName: `Screen ${index + 1}`, startsAt: "2026-10-10T08:30:00Z", priceInPaise: 28000, currency: "INR" as const },
    { id: `${movieId}-evening`, movieId, cinemaName: "FairGate Demo Cinema", screenName: `Screen ${index + 1}`, startsAt: "2026-10-10T13:30:00Z", priceInPaise: 35000, currency: "INR" as const },
  ]),
];
