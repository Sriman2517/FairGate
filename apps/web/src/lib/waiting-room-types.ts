export interface WaitingRoomState {
  status: "not_joined" | "waiting" | "admitted";
  position: number | null;
  expiresAt: string | null;
  serverTime: string;
  pollAfterMs: number;
  turnId?: string | null;
}

export interface WaitingRoomResult {
  waitingRoom?: WaitingRoomState;
  error?: string;
  notice?: string;
  signInRequired?: boolean;
  closed?: boolean;
  retryAfterSeconds?: number;
}
