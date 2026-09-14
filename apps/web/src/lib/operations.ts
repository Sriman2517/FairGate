import "server-only";
import { bookingRequest } from "./bookings";

export interface OperationsSnapshot {
  inventoryObservedAt: string;
  queueObservedAt: string | null;
  queueStatus: "available" | "unavailable";
  limit: number;
  hasMore: boolean;
  shows: {
    id: string; movieTitle: string; cinemaName: string; screenName: string; startsAt: string;
    totalSeats: number; bookedSeats: number; availableSeats: number;
    waitingCustomers: number | null; activeTurns: number | null; checkoutCapacity: number;
  }[];
}

export async function getOperations(): Promise<OperationsSnapshot | null> {
  const response = await bookingRequest("/operations/shows");
  if (response.status === 403) return null;
  if (!response.ok) throw new Error("Could not load operations. Please try again.");
  return response.json();
}
