/** Keep a tap until its destination can be opened, then acknowledge it once.
 * A cold-start response and the live response listener can report the same tap. */
export function createPushTapQueue(input: {
  dispatch(data: unknown): boolean;
  received(id: string, data: unknown): void;
  consumed(id: string): void;
}) {
  let pending: { id: string; data: unknown } | null = null;
  const handled = new Set<string>();
  function drain(): void {
    const target = pending;
    if (!target || !input.dispatch(target.data)) return;
    if (pending === target) pending = null;
    input.consumed(target.id);
  }
  return {
    receive(id: string, data: unknown): void {
      if (id && handled.has(id)) return;
      if (id) handled.add(id);
      input.received(id, data);
      pending = { id, data };
      drain();
    },
    drain,
    hasPending: () => pending !== null,
  };
}
