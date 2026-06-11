// Invite link helpers (mobile side). Keep inviteUrl in sync with
// functions/src/chats/inviteLogic.ts.

export type InviteJoinMode = 'open' | 'approval_required';

/** Public https invite URL (used for Copy/Share). */
export function inviteUrl(code: string): string {
  return `https://links.offlinesms.com/join/${code}`;
}

/** Custom-scheme deep link (used for in-app navigation tests / fallbacks). */
export function inviteDeepLink(code: string): string {
  return `offlinesms://join/${code}`;
}

/** Extract an invite code from any supported invite URL/deep-link, or null.
 *  Host-agnostic on purpose: links shared before the move to
 *  links.offlinesms.com (plain offlinesms.com) must keep working. */
export function parseInviteCode(url: string): string | null {
  const m = url.match(/\/join\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
