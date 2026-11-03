import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { lightSemantic, darkSemantic } from '../../../packages/design-tokens/src/semantic';
const mock = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('react-native', () => ({ useColorScheme: () => 'light' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: mock }));
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
let renderer: ReactTestRenderer;
let current: ReturnType<typeof useTheme>;
function Child() { current = useTheme(); return null; }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.setItem.mockResolvedValue(undefined); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
function contrast(a: string, b: string) {
  const lum = (hex: string) => hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05);
}
describe('theme restoration and pinned notice contrast', () => {
  it.each([['light', lightSemantic.color], ['dark', darkSemantic.color]])('keeps readable pinned title and preview in %s', (_name, colors) => {
    expect(contrast(colors.notice.background, colors.notice.text)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.notice.background, colors.notice.title)).toBeGreaterThanOrEqual(4.5);
  });
  it.each([['light', lightSemantic.color], ['dark', darkSemantic.color]])('keeps small error text readable across %s post surfaces', (_name, colors) => {
    for (const surface of [colors.background.app, colors.background.surface, colors.background.subtle]) {
      expect(contrast(surface, colors.state.errorText)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('does not overwrite the current server theme with a delayed cached preference', async () => {
    let finish!: (value: string) => void; mock.getItem.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(createElement(ThemeProvider, { userPreference: 'dark', children: createElement(Child) })); });
    expect(current.resolved).toBe('dark'); await act(async () => finish('light')); expect(current.resolved).toBe('dark');
  });
  it('does not overwrite a manual choice when the startup cache resolves later', async () => {
    let finish!: (value: string) => void; mock.getItem.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(createElement(ThemeProvider, { children: createElement(Child) })); });
    await act(async () => current.setPreference('dark')); await act(async () => finish('light')); expect(current.resolved).toBe('dark');
  });
});
