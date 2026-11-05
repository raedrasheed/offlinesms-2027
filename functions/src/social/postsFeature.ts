import { HttpsError } from 'firebase-functions/v2/https';

// Product decision: Posts are retired independently of Clips. No environment
// or remote Clips setting can re-enable them in this release.
export const POSTS_ENABLED: boolean = false;
export function assertPostsEnabled(): void {
  if (!POSTS_ENABLED) throw new HttpsError('failed-precondition', 'posts-disabled');
}
