/** Keep an invitation through sign-in/profile completion and navigator
 * remounts. A link is only consumed once a valid account can open it. */
export function createPendingInviteNavigation(input: {
  take(): Promise<string | null>; save(code: string): Promise<void>;
  account(): string | null; ready(): boolean; open(code: string): void;
}) {
  const valid = (code: unknown): code is string => typeof code === 'string' && /^[A-Za-z0-9]{8,40}$/.test(code);
  let storage = Promise.resolve(), draining = false, requested = false, generation = 0;
  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = storage.then(run); storage = result.then(() => undefined, () => undefined); return result;
  }
  async function drain(): Promise<void> {
    requested = true;
    if (draining) return;
    draining = true;
    try {
      while (requested) {
        requested = false;
        const account = input.account(), at = generation;
        if (!account || !input.ready()) return;
        const code = await serialized(input.take);
        if (!valid(code)) continue;
        if (input.account() !== account || !input.ready()) {
          await serialized(async () => { if (at === generation) await input.save(code); });
          return;
        }
        try { input.open(code); }
        catch (error) {
          await serialized(async () => { if (at === generation) await input.save(code); });
          throw error;
        }
      }
    } finally {
      draining = false;
      if (requested) await drain();
    }
  }
  async function receive(code: string): Promise<void> {
    if (!valid(code)) return;
    generation++;
    await serialized(() => input.save(code));
    await drain();
  }
  return { receive, drain };
}
