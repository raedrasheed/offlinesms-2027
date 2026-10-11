import { describe, expect, it } from 'vitest';
import { pollFormScrollOffset as reveal } from '../src/components/chat/pollFormLayout';

describe('poll form focused input', () => {
  it('keeps an already visible input stationary', () => { expect(reveal(100, 44, 600, 0)).toBe(0); });
  it('reveals the focused lower option when the keyboard reduces the viewport', () => {
    expect(reveal(420, 48, 600, 0)).toBe(0);
    expect(reveal(420, 48, 250, 0)).toBe(230);
  });
  it('scrolls back to the question from the last option', () => { expect(reveal(30, 80, 250, 400)).toBe(18); });
  it('handles an input near the end of a long twelve-option form', () => { expect(reveal(1050, 48, 240, 500)).toBe(870); });
  it('anchors a tall multiline question at its top', () => { expect(reveal(40, 300, 200, 0)).toBe(28); });
  it('does not jump before layout or scroll to a negative offset', () => {
    expect(reveal(10, 40, 0, 100)).toBe(100);
    expect(reveal(0, 40, 200, 100)).toBe(0);
  });
});
