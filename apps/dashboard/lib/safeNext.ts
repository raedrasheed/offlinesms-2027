// Where the login page sends a signed-in admin. Only a path on this dashboard is
// accepted; anything else (another origin, a protocol-relative "//host", a
// backslash form browsers treat as "//", a javascript: URL) falls back to /admin,
// so a crafted /login?next=… link cannot forward a fresh session elsewhere.
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/admin';
  if (/[\u0000-\u001f\u007f]/.test(next)) return '/admin';
  return next;
}
