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

// Fictional fixtures for learning. These are not live cinema listings.
export const movies: Movie[] = [
  {
    id: "the-last-signal",
    title: "The Last Signal",
    synopsis: "A radio engineer follows a mysterious transmission across her city.",
    language: "Telugu",
    durationMinutes: 142,
  },
  {
    id: "second-sunrise",
    title: "Second Sunrise",
    synopsis: "Two estranged friends reunite to restore a small seaside cinema.",
    language: "Hindi",
    durationMinutes: 128,
  },
  {
    id: "after-the-rain",
    title: "After the Rain",
    synopsis: "A young photographer documents a neighbourhood rebuilding after a storm.",
    language: "English",
    durationMinutes: 116,
  },
];

// Fixed UTC times for the demo; a listed show does not imply seat availability.
export const shows: Show[] = [
  {
    id: "last-signal-evening",
    movieId: "the-last-signal",
    cinemaName: "FairGate Demo Cinema",
    screenName: "Screen 1",
    startsAt: "2026-10-10T12:30:00Z",
    priceInPaise: 32000,
    currency: "INR",
  },
  {
    id: "last-signal-night",
    movieId: "the-last-signal",
    cinemaName: "FairGate Demo Cinema",
    screenName: "Screen 1",
    startsAt: "2026-10-10T16:00:00Z",
    priceInPaise: 35000,
    currency: "INR",
  },
  {
    id: "second-sunrise-evening",
    movieId: "second-sunrise",
    cinemaName: "FairGate Demo Cinema",
    screenName: "Screen 2",
    startsAt: "2026-10-10T13:00:00Z",
    priceInPaise: 28000,
    currency: "INR",
  },
];
