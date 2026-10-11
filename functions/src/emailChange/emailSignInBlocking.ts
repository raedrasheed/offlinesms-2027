// Identity Platform blocking functions that keep a replaced email address from
// signing in by password or receiving a password-reset / sign-in-link email.
// Logic and tests: ./signInGuard.ts.

import { beforeUserSignedIn, beforeEmailSent } from 'firebase-functions/v2/identity';
import { handleBeforeSignIn, handleBeforeEmailSent } from './signInGuard';

export const guardEmailSignIn = beforeUserSignedIn(async event => { await handleBeforeSignIn(event); });
export const guardEmailSent = beforeEmailSent(async event => { await handleBeforeEmailSent(event); });
