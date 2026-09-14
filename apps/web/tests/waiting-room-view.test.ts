import assert from "node:assert/strict";
import test from "node:test";
import { turnSecondsRemaining, waitingRoomView } from "../src/lib/waiting-room-view";
import type { WaitingRoomState } from "../src/lib/waiting-room-types";

const turn: WaitingRoomState = {
  status: "admitted", position: null, pollAfterMs: 5000,
  serverTime: "2026-01-01T10:00:00.000Z", expiresAt: "2026-01-01T10:02:00.000Z",
};

test("checkout closes at the deadline without waiting for another poll", () => {
  const result = { waitingRoom: turn };
  assert.equal(turnSecondsRemaining(turn), 120);
  assert.equal(waitingRoomView(result, turnSecondsRemaining(turn, 119999)), "admitted");
  assert.equal(waitingRoomView(result, turnSecondsRemaining(turn, 120000)), "expired");
  assert.equal(turnSecondsRemaining(turn, 180000), 0);
});

test("a fresh server snapshot recovers from an expired turn and ignores device wall time", () => {
  const expired = { ...turn, expiresAt: turn.serverTime };
  assert.equal(turnSecondsRemaining(expired), 0);
  // These fixture dates are in the past; only server-relative elapsed time matters.
  assert.equal(waitingRoomView({ waitingRoom: turn }, turnSecondsRemaining(turn)), "admitted");
  assert.equal(turnSecondsRemaining(turn, 60250), 60);
});

test("missing or invalid deadlines cannot open checkout", () => {
  for (const expiresAt of [null, "invalid", "2026-01-01T09:59:00.000Z"]) {
    const room = { ...turn, expiresAt };
    assert.equal(waitingRoomView({ waitingRoom: room }, turnSecondsRemaining(room)), "expired");
  }
  assert.equal(turnSecondsRemaining({ ...turn, serverTime: "invalid" }), 0);
});

test("sign-in, closure, and failed checks override a stale admission", () => {
  assert.equal(waitingRoomView({ waitingRoom: turn, signInRequired: true, error: "Sign in" }, 100), "sign_in");
  assert.equal(waitingRoomView({ waitingRoom: turn, closed: true, error: "Sold out" }, 100), "closed");
  assert.equal(waitingRoomView({ waitingRoom: turn, error: "Unavailable" }, 100), "unavailable");
  assert.equal(waitingRoomView({ retryAfterSeconds: 60, error: "Slow down" }, null), "unavailable");
});

test("joining and waiting never enable seat selection", () => {
  for (const status of ["not_joined", "waiting"] as const) {
    const room = { ...turn, status };
    assert.equal(turnSecondsRemaining(room), null);
    assert.equal(waitingRoomView({ waitingRoom: room }, null), status);
  }
  assert.equal(waitingRoomView({}, null), "unavailable");
});
