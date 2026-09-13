export interface WaitingRoomState {
  status: "not_joined" | "waiting" | "admitted";
  position: number | null;
  expiresAt: string | null;
  serverTime: string;
  pollAfterMs: number;
}

export interface WaitingRoomResult {
  waitingRoom?: WaitingRoomState;
  error?: string;
  signInRequired?: boolean;
  closed?: boolean;
}
