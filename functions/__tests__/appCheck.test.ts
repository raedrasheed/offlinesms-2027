import { describe, it, expect, afterEach } from 'vitest';
import { appCheckEnforced, appCheckOptions } from '../src/lib/appCheck';

const ORIG = process.env.APPCHECK_ENFORCE;
afterEach(() => {
  if (ORIG === undefined) delete process.env.APPCHECK_ENFORCE;
  else process.env.APPCHECK_ENFORCE = ORIG;
});

describe('appCheck enforcement flag (F2 staged rollout)', () => {
  it('defaults to OFF when unset (existing clients keep working)', () => {
    delete process.env.APPCHECK_ENFORCE;
    expect(appCheckEnforced()).toBe(false);
    expect(appCheckOptions()).toEqual({ enforceAppCheck: false, consumeAppCheckToken: false });
  });

  it('"off" → not enforced', () => {
    process.env.APPCHECK_ENFORCE = 'off';
    expect(appCheckEnforced()).toBe(false);
  });

  it('"on" (case/space tolerant) → enforced', () => {
    process.env.APPCHECK_ENFORCE = 'on';
    expect(appCheckEnforced()).toBe(true);
    expect(appCheckOptions().enforceAppCheck).toBe(true);

    process.env.APPCHECK_ENFORCE = '  ON ';
    expect(appCheckEnforced()).toBe(true);
  });

  it('any other value → not enforced (fail safe)', () => {
    process.env.APPCHECK_ENFORCE = 'true';
    expect(appCheckEnforced()).toBe(false);
    process.env.APPCHECK_ENFORCE = '1';
    expect(appCheckEnforced()).toBe(false);
  });

  it('never enables replay-consumption by default', () => {
    process.env.APPCHECK_ENFORCE = 'on';
    expect(appCheckOptions().consumeAppCheckToken).toBe(false);
  });
});
