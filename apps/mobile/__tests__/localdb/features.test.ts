import { describe, it, expect } from 'vitest';
import { LOCAL_FIRST_CHAT_LIST_ENABLED } from '../../src/config/features';

describe('feature flags', () => {
  it('local-first chat list defaults to false (no env override)', () => {
    // EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST is unset in the test env.
    expect(LOCAL_FIRST_CHAT_LIST_ENABLED).toBe(false);
  });
});
