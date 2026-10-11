import { describe, it, expect } from 'vitest';
import { createKeyedSubscriptions } from '../src/lib/keyedSubscriptions';

function harness() {
  const started: string[] = [];
  const stopped: string[] = [];
  const subs = createKeyedSubscriptions(k => { started.push(k); return () => { stopped.push(k); }; });
  return { subs, started, stopped };
}

describe('createKeyedSubscriptions', () => {
  it('re-ordering the list (a new message moves a chat to the top) starts and stops nothing', () => {
    const { subs, started, stopped } = harness();
    const chats = Array.from({ length: 50 }, (_, i) => `c${i}|u${i}`);
    subs.sync(chats);
    expect(started).toHaveLength(50);
    subs.sync([chats[7], ...chats.filter((_, i) => i !== 7)]);
    expect(started).toHaveLength(50);
    expect(stopped).toHaveLength(0);
  });

  it('applies only the difference', () => {
    const { subs, started, stopped } = harness();
    subs.sync(['a', 'b', 'c']);
    subs.sync(['b', 'c', 'd']);
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    expect(stopped).toEqual(['a']);
    expect(subs.size()).toBe(3);
  });

  it('clear stops everything and tolerates a throwing unsubscribe', () => {
    const subs = createKeyedSubscriptions(k => () => { if (k === 'x') throw new Error('x'); });
    subs.sync(['x', 'y']);
    subs.clear();
    expect(subs.size()).toBe(0);
  });
});
