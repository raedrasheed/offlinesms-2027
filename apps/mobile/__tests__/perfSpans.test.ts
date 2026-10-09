// Timing spans used for the matched baseline/updated test builds.
import { describe, it, expect } from 'vitest';
import { perfBegin, perfObserve, perfReport, perfNow } from '../src/lib/perf';

const spans = () => perfReport().filter(e => e.kind === 'span').map(e => e.name);

describe('perf spans', () => {
  it('push_to_visible ends only when the tapped message is rendered', () => {
    perfBegin('push_to_visible', { id: 'm9' });
    perfObserve(['m1', 'm2']);
    expect(spans()).not.toContain('push_to_visible');
    perfObserve(['m9', 'm1']);
    expect(spans().filter(s => s === 'push_to_visible')).toHaveLength(1);
    perfObserve(['m9']); // ended once
    expect(spans().filter(s => s === 'push_to_visible')).toHaveLength(1);
  });
  it('older_to_visible needs more rows AND a different oldest row (a new incoming message does not count)', () => {
    perfBegin('older_to_visible', { minCount: 3, lastNot: 'old1' });
    perfObserve(['new', 'm2', 'old1']);           // +1 at the top: not older history
    expect(spans()).not.toContain('older_to_visible');
    perfObserve(['new', 'm2', 'old1', 'old0']);    // older row appended at the end
    expect(spans()).toContain('older_to_visible');
  });
  it('conversation_open ends on the first rows; send uses the tap time', () => {
    perfBegin('conversation_open');
    perfObserve([]);
    expect(spans()).not.toContain('conversation_open');
    perfObserve(['a']);
    expect(spans()).toContain('conversation_open');
    const t = perfNow() - 50;
    perfBegin('send_to_visible', { id: 'local_1' }, t);
    perfObserve(['local_1']);
    const e = perfReport().filter(x => x.name === 'send_to_visible').at(-1)!;
    expect(e.ms).toBeGreaterThanOrEqual(50);
  });
});
