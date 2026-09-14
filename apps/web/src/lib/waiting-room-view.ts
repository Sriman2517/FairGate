import type { WaitingRoomResult, WaitingRoomState } from "./waiting-room-types";

// Count down from a server snapshot using elapsed time, never the device's clock.
export function turnSecondsRemaining(room: WaitingRoomState | undefined, elapsedMs = 0): number | null {
  if (room?.status !== "admitted") return null;
  const duration = Date.parse(room.expiresAt ?? "") - Date.parse(room.serverTime);
  if (!Number.isFinite(duration) || !Number.isFinite(elapsedMs)) return 0;
  return Math.max(0, Math.ceil((duration - Math.max(0, elapsedMs)) / 1000));
}

export function waitingRoomView(result: WaitingRoomResult, remaining: number | null) {
  // An error must never leave an old checkout snapshot enabled.
  if (result.signInRequired) return "sign_in";
  if (result.closed) return "closed";
  if (result.error || !result.waitingRoom) return "unavailable";
  if (result.waitingRoom.status === "admitted") return remaining !== null && remaining > 0 ? "admitted" : "expired";
  return result.waitingRoom.status;
}
