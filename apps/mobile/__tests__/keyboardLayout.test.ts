import { describe, it, expect } from 'vitest';
import { keyboardAvoidBehavior, AUTH_SCROLL_PROPS } from '../src/lib/keyboardLayout';

describe('keyboardAvoidBehavior', () => {
  it('iOS / iPadOS use padding so the bottom CTA is pushed above the keyboard', () => {
    expect(keyboardAvoidBehavior('ios')).toBe('padding');
  });
  it('Android resizes the window itself → no behavior', () => {
    expect(keyboardAvoidBehavior('android')).toBeUndefined();
    expect(keyboardAvoidBehavior('web')).toBeUndefined();
  });
});

describe('AUTH_SCROLL_PROPS — keyboard-safe auth scroll behavior', () => {
  it('lets a tap outside an input dismiss the keyboard while buttons still fire', () => {
    expect(AUTH_SCROLL_PROPS.keyboardShouldPersistTaps).toBe('handled');
  });
  it('supports drag-to-dismiss the keyboard', () => {
    expect(AUTH_SCROLL_PROPS.keyboardDismissMode).toBe('interactive');
  });
  it('does not bounce or show a scrollbar (CTA-pinned layout)', () => {
    expect(AUTH_SCROLL_PROPS.bounces).toBe(false);
    expect(AUTH_SCROLL_PROPS.showsVerticalScrollIndicator).toBe(false);
  });
});
