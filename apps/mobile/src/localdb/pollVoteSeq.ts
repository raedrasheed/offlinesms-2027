// Order of this device's poll votes: a counter stored next to device_id
// (sync_state, kept on sign-out), so it survives restarts and never depends
// on the clock. The server compares it only with this device's earlier votes.
import { getCursor, setCursor } from './repositories/syncStateRepo';

let current: { deviceId: string; n: number } | null = null;

/** Next vote seq for `deviceId`: strictly increasing, also across restarts and concurrent calls. */
export async function nextVoteSeq(deviceId: string): Promise<number> {
  if (current?.deviceId !== deviceId) {
    const stored = await getCursor('poll_vote_seq');
    // Another call may have loaded it while this one waited.
    if (current?.deviceId !== deviceId) current = { deviceId, n: stored };
  }
  const state = current!;
  const n = ++state.n;
  await setCursor('poll_vote_seq', state.n);
  return n;
}

/** Tests only: forget the in-memory counter, as an app restart does. */
export function resetVoteSeqCache(): void {
  current = null;
}
