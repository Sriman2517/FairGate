import "server-only";
import { cookies } from "next/headers";
import { sessionCookie } from "./auth";
import { apiRequest } from "./api-request";

export interface Seat {
  label: string;
  row: string;
  number: number;
  available: boolean;
}

export interface BookingShow {
  movieId: string;
  movieTitle: string;
  cinemaName: string;
  screenName: string;
  startsAt: string;
}

export interface ShowDetails extends BookingShow {
  id: string;
  priceInPaise: number;
  currency: "INR";
}

export interface Booking {
  id: string;
  showId: string;
  seatLabel: string;
  priceInPaise: number;
  currency: "INR";
  createdAt: string;
  show: BookingShow;
}

export class AuthenticationRequired extends Error {}


export async function bookingRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) throw new AuthenticationRequired();

  const headers = new Headers(options.headers);
  // Forward only this session, never the browser's complete Cookie header.
  headers.set("Authorization", `Bearer ${token}`);
  const response = await apiRequest(path, {
    ...options,
    headers,
  });
  if (response.status === 401) throw new AuthenticationRequired();
  return response;
}

export async function getShow(showId: string): Promise<{ show: ShowDetails; seats: Seat[] } | null> {
  const response = await apiRequest(`/shows/${encodeURIComponent(showId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load this show's seats.");
  return response.json();
}

export async function getBookings(): Promise<Booking[]> {
  const response = await bookingRequest("/bookings");
  if (!response.ok) throw new Error("Could not load your bookings.");
  const data: { bookings: Booking[] } = await response.json();
  return data.bookings;
}

export async function getBooking(bookingId: string): Promise<Booking | null> {
  const response = await bookingRequest(`/bookings/${encodeURIComponent(bookingId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load your booking.");
  const data: { booking: Booking } = await response.json();
  return data.booking;
}
