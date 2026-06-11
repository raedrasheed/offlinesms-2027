import { describe, it, expect } from 'vitest';
import { LOCAL_FIRST_CHAT_LIST_ENABLED, LOCAL_FIRST_CONVERSATION_ENABLED } from '../../src/config/features';

// The local-first paths are the production default (Phase 22B/22C shipped on).
// These guards trip if anyone accidentally flips the defaults back to off.
// Override semantics (EXPO_PUBLIC_LOCAL_FIRST_* = "0" / "false") are exercised
// by features.ts's own envFlag consumers; here we only care about the
// no-override default.

describe('feature flags', () => {
  it('local-first chat list defaults to on (no env override)', () => {
    // EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST is unset in the test env.
    expect(LOCAL_FIRST_CHAT_LIST_ENABLED).toBe(true);
  });

  it('local-first conversation defaults to on (no env override)', () => {
    expect(LOCAL_FIRST_CONVERSATION_ENABLED).toBe(true);
  });
});
