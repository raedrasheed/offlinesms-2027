// Thin wrapper around the `claimUsername` callable.
//
// The callable is the only path that mutates `usernames/{lower}`; clients
// never write to that collection directly. The function returns the freshly
// claimed username so the UI can confirm what the server actually stored.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

export type ClaimUsernameRequest = {
  username: string;
  displayName: string;
  about?: string | null;
};

export type ClaimUsernameResult = {
  uid: string;
  username: string;
  usernameLower: string;
};

export class ClaimUsernameError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'ClaimUsernameError';
  }
}

export async function claimUsername(req: ClaimUsernameRequest): Promise<ClaimUsernameResult> {
  const fn = httpsCallable<ClaimUsernameRequest, ClaimUsernameResult>(
    getFunctions(app),
    'claimUsername',
  );
  try {
    const res = await fn(req);
    return res.data;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'internal';
    const message = (e as { message?: string })?.message;
    throw new ClaimUsernameError(code, message);
  }
}

export function claimUsernameErrorCopy(code: string): string {
  switch (code) {
    case 'functions/already-exists':
    case 'already-exists':
      return 'That username is taken. Try another.';
    case 'functions/invalid-argument':
    case 'invalid-argument':
      return 'Please check the values and try again.';
    case 'functions/permission-denied':
    case 'permission-denied':
      return 'You don’t have permission to claim a username right now.';
    case 'functions/unauthenticated':
    case 'unauthenticated':
      return 'Sign in again, then try once more.';
    default:
      return 'We couldn’t save your profile. Please try again.';
  }
}
