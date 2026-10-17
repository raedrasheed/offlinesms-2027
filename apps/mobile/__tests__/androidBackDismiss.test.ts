import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
// Exercise the installed navigation library's real focus/blur lifecycle.
import NavigationContext from '../node_modules/@react-navigation/core/src/NavigationContext';
const native = vi.hoisted(() => ({ os: 'android', listeners: [] as Array<() => boolean> }));
vi.mock('@react-navigation/native', async () => ({
  useFocusEffect: (await import('../node_modules/@react-navigation/core/src/useFocusEffect')).default,
}));
vi.mock('react-native', () => ({
  Platform: { get OS() { return native.os; } },
  BackHandler: { addEventListener: (_event: string, callback: () => boolean) => {
    native.listeners.push(callback);
    return { remove: () => { native.listeners = native.listeners.filter(f => f !== callback); } };
  } },
}));
import { useAndroidBackDismiss } from '../src/hooks/useAndroidBackDismiss';

let renderer: ReactTestRenderer | undefined;
let focused = true;
const events = new Map<string, Set<() => void>>();
const navigation = {
  isFocused: () => focused,
  addListener: (event: string, fn: () => void) => {
    const set = events.get(event) ?? new Set(); set.add(fn); events.set(event, set);
    return () => set.delete(fn);
  },
};
function focus(value: boolean) { focused = value; events.get(value ? 'focus' : 'blur')?.forEach(fn => fn()); }
function back() { return [...native.listeners].reverse().some(fn => fn()); }
function Panel({ dismiss }: { dismiss: () => void }) {
  const [open, setOpen] = useState(true);
  useAndroidBackDismiss(open, () => { setOpen(false); dismiss(); });
  return createElement('Panel', { open });
}
async function mount(dismiss = vi.fn()) {
  await act(async () => { renderer = create(createElement(NavigationContext.Provider, { value: navigation as any }, createElement(Panel, { dismiss }))); });
  return dismiss;
}
beforeEach(() => { native.os = 'android'; native.listeners = []; events.clear(); focused = true; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

describe('focused inline-panel Android Back', () => {
  it('dismisses the panel first, then lets subsequent presses reach navigation/root handling', async () => {
    const navigate = vi.fn(() => false); native.listeners.push(navigate);
    const dismiss = await mount();
    await act(async () => { expect(back()).toBe(true); });
    expect(dismiss).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled();
    expect(renderer!.root.find(node => String(node.type) === 'Panel').props.open).toBe(false);
    expect(back()).toBe(false); expect(navigate).toHaveBeenCalledOnce();
  });
  it('cannot consume Back on another screen, and reattaches exactly once when focused again', async () => {
    const dismiss = await mount();
    await act(async () => focus(false)); expect(native.listeners).toHaveLength(0); expect(back()).toBe(false);
    await act(async () => { focus(true); focus(true); }); expect(native.listeners).toHaveLength(1);
    await act(async () => { back(); }); expect(dismiss).toHaveBeenCalledOnce();
  });
  it('does not subscribe before focus, and removes its listener when unmounted', async () => {
    focused = false; await mount(); expect(native.listeners).toHaveLength(0);
    await act(async () => focus(true)); expect(native.listeners).toHaveLength(1);
    await act(async () => renderer!.unmount()); renderer = undefined; expect(native.listeners).toHaveLength(0);
  });
  it.each(['ios', 'web'])('leaves %s back behavior untouched', async os => {
    native.os = os; const dismiss = await mount(); expect(native.listeners).toHaveLength(0);
    expect(back()).toBe(false); expect(dismiss).not.toHaveBeenCalled();
  });
});
