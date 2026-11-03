import { validClipId } from './clipReference';

/** Drain on both auth and navigator readiness, and after persisting a newly
 * received link. Serial storage prevents two events taking the same link. */
export function createPendingClipNavigation(input: {
  take(): Promise<string | null>; save(id: string): Promise<void>;
  account(): string | null; ready(): boolean; open(id: string): void;
}) {
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
        const id = await serialized(input.take);
        if (!validClipId(id)) continue;
        if (input.account() !== account || !input.ready()) {
          // A newer incoming link wins if auth changes while storage resolves.
          await serialized(async () => { if (at === generation) await input.save(id); });
          return;
        }
        input.open(id);
      }
    } finally {
      draining = false;
      // Readiness can change while an old-account read is being put back.
      if (requested) await drain();
    }
  }
  async function receive(id: string): Promise<void> {
    if (!validClipId(id)) return;
    generation++;
    await serialized(() => input.save(id));
    await drain();
  }
  return { receive, drain };
}
