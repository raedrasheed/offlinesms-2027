// Deterministic avatar background colours, drawn from the design-system
// palette so the same user always gets the same colour across screens.

const AVATAR_COLORS = [
  '#1F7BA8', // primary
  '#E84393', // pink
  '#7C5CFC', // purple
  '#22C55E', // green
  '#F59E0B', // amber
  '#0EA5E9', // sky
  '#EF4444', // red
  '#14B8A6', // teal
];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
