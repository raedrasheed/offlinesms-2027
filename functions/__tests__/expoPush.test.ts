import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendExpoPush } from '../src/notifications/expoPush';
import { buildExpoMessage } from '../src/notifications/expoPushLogic';

const msg = (n: number) => buildExpoMessage(`ExponentPushToken[t${n}]`, {
  title: 'T', body: 'B', data: {}, conversationId: 'c',
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sendExpoPush', () => {
  it('returns one ticket per message, aligned to input order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [
        { status: 'ok', id: 'r0' },
        { status: 'error', message: 'dead', details: { error: 'DeviceNotRegistered' } },
      ] }),
    })) as any);

    const tickets = await sendExpoPush([msg(0), msg(1)]);
    expect(tickets).toHaveLength(2);
    expect(tickets[0].status).toBe('ok');
    expect(tickets[1].details?.error).toBe('DeviceNotRegistered');
  });

  it('empty input does not call the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f as any);
    expect(await sendExpoPush([])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('HTTP failure maps every message to a transient error (not token death)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as any);
    const tickets = await sendExpoPush([msg(0), msg(1)]);
    expect(tickets.map(t => t.status)).toEqual(['error', 'error']);
    expect(tickets[0].message).toContain('429');
  });

  it('network throw maps to transient errors, never crashes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }) as any);
    const tickets = await sendExpoPush([msg(0)]);
    expect(tickets[0].status).toBe('error');
    expect(tickets[0].message).toContain('ECONNRESET');
  });

  it('chunks >100 messages into multiple requests', async () => {
    const f = vi.fn(async (_url: string, init: any) => {
      const batch = JSON.parse(init.body) as unknown[];
      return { ok: true, json: async () => ({ data: batch.map(() => ({ status: 'ok' })) }) };
    });
    vi.stubGlobal('fetch', f as any);
    const tickets = await sendExpoPush(Array.from({ length: 150 }, (_, i) => msg(i)));
    expect(tickets).toHaveLength(150);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
