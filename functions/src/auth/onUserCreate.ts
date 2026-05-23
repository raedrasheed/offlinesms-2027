// On user create — bootstrap the user profile and wallet.
//
// The user doc starts with `profileCompleted: false` so the mobile app's
// onboarding gate routes the user into the profile-completion screen until
// `claimUsername` flips the flag.

import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const onUserCreate = beforeUserCreated(async (event) => {
  const user = event.data;
  if (!user) return;
  const db = getFirestore();
  await db.collection('users').doc(user.uid).set({
    displayName:      user.displayName ?? null,
    phoneNumber:      user.phoneNumber ?? null,
    email:            user.email ?? null,
    username:         null,
    usernameLower:    null,
    about:            null,
    profileCompleted: false,
    createdAt:        FieldValue.serverTimestamp(),
    status:           'active',
  }, { merge: true });
  await db.collection('wallets').doc(user.uid).set({
    balance:    50,            // 50-pt welcome credit
    reserved:   0,
    createdAt:  FieldValue.serverTimestamp(),
  }, { merge: true });
});
