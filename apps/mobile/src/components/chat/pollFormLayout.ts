/** Keep the focused input inside the form viewport after the keyboard resizes it. */
export function pollFormScrollOffset(top: number, height: number, viewport: number, current: number): number {
  if (viewport <= 0) return current;
  const gap = 12;
  if (top < current + gap || height > viewport - gap * 2) return Math.max(0, top - gap);
  if (top + height > current + viewport - gap) return Math.max(0, top + height + gap - viewport);
  return current;
}
