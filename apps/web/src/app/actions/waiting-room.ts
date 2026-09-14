"use server";

import { revalidatePath } from "next/cache";
import { readWaitingRoom } from "../../lib/waiting-room";
import type { WaitingRoomResult } from "../../lib/waiting-room-types";

export async function visitWaitingRoom(previous: WaitingRoomResult, formData: FormData): Promise<WaitingRoomResult> {
  const showId = formData.get("showId");
  const operation = formData.get("operation");
  if (operation !== "join" && operation !== "status" && operation !== "leave") return { error: "Please try again." };
  const result = await readWaitingRoom(showId, operation);
  if (result.waitingRoom?.status === "admitted" && previous.waitingRoom?.status !== "admitted") {
    // Admission may follow a wait: refresh the seat snapshot as checkout opens.
    revalidatePath(`/shows/${showId}`);
  }
  if (operation === "leave" && result.waitingRoom?.status === "not_joined") {
    return { ...result, notice: "You are out of this waiting room. Your confirmed bookings are unchanged." };
  }
  return result;
}
