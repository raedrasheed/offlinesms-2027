/** Stable recovery reasons for invite failures; raw server messages stay out
 * of the UI. Older deployments can omit details, so also recognize the
 * callable's exact machine-readable message. */
export type InviteProblem = 'username' | 'expired' | 'disabled' | 'full' | 'permission' | 'signin' | 'rateLimit' | 'offline' | 'generic';

export function inviteProblem(error: unknown): InviteProblem {
  const value = error as { code?: unknown; message?: unknown; details?: { reason?: unknown } } | null;
  const code = typeof value?.code === 'string' ? value.code.replace(/^functions\//, '') : '';
  const reason = typeof value?.details?.reason === 'string' ? value.details.reason : value?.message;
  if (reason === 'username-required' || reason === 'profile-incomplete') return 'username';
  if (reason === 'invite-disabled') return 'disabled';
  if (reason === 'group-full' || reason === 'member-limit-reached') return 'full';
  if (code === 'not-found' || code === 'invalid-argument') return 'expired';
  if (code === 'permission-denied') return 'permission';
  if (code === 'unauthenticated') return 'signin';
  if (code === 'resource-exhausted') return 'rateLimit';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'offline';
  return 'generic';
}

export function inviteNeedsUsername(profile: { username?: unknown } | null | undefined): boolean {
  return typeof profile?.username !== 'string' || profile.username.trim().length === 0;
}
