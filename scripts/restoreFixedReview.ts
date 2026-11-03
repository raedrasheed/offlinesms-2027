// Restore the existing seeded App Review account without sending SMS or
// resetting its chats/wallet. Requires Admin SDK credentials for --project.
// Usage: npx tsx scripts/restoreFixedReview.ts --project=offlinesms-prod-2027
// Optional: --uid=<already-designated-demo-uid> or --disable.
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { FIXED_REVIEW_PHONE, FIXED_REVIEW_CODE } from '../functions/src/phoneAuth/fixedReview';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const projectId = arg('project');
  if (!projectId) throw new Error('Pass --project=<Firebase project id>.');
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const sa = credPath ? JSON.parse(readFileSync(credPath, 'utf8')) : null;
  if (sa?.project_id && sa.project_id !== projectId) throw new Error('Credential project does not match --project.');
  initializeApp({ projectId, ...(sa ? { credential: cert(sa) } : {}) });
  const auth = getAuth();
  const db = getFirestore();
  const policyRef = db.doc('smsConfig/otp');
  if (process.argv.includes('--disable')) {
    await policyRef.set({ signin: { fixedReview: { enabled: false } }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log('Fixed review login disabled.');
    return;
  }

  const policy = await policyRef.get();
  let uid = arg('uid') || policy.get('signin.fixedReview.uid');
  if (!uid) {
    // Historical seedReviewDemo.ts created this exact phone account. No new
    // account is silently substituted: missing/ambiguous accounts fail closed.
    uid = (await auth.getUserByPhoneNumber(FIXED_REVIEW_PHONE)).uid;
  }
  if (typeof uid !== 'string') throw new Error('Invalid demo uid.');
  const user = await auth.getUser(uid);
  const profileRef = db.doc(`users/${uid}`);
  const privateRef = profileRef.collection('userPrivate').doc('profile');
  const [profile, privateProfile] = await Promise.all([profileRef.get(), privateRef.get()]);
  const claims = user.customClaims ?? {};
  const designated = claims.demoReview === true && Object.keys(claims).length === 1;
  const legacy = Object.keys(claims).length === 0 && user.phoneNumber === FIXED_REVIEW_PHONE
    && profile.get('displayName') === 'OfflineSMS Reviewer'
    && profile.get('username') === 'reviewer'
    && profile.get('about') === 'App Review demo account';
  if (user.disabled || user.email || !profile.exists || profile.get('status') !== 'active'
    || (!designated && !legacy)
    || (user.phoneNumber && user.phoneNumber !== FIXED_REVIEW_PHONE)) {
    throw new Error('Refusing: account is not an active, unprivileged designated/legacy App Review demo.');
  }
  for (const data of [profile.data(), privateProfile.data()]) {
    if (data?.email || (data?.phoneNumber && data.phoneNumber !== FIXED_REVIEW_PHONE)) {
      throw new Error('Refusing: demo profile contains another identity.');
    }
  }

  // Stage while disabled; a failed/interrupted migration cannot open access.
  // This does not alter the SMS master/stop/purpose/relay settings.
  await policyRef.set({ signin: { fixedReview: { enabled: false, uid } } }, { merge: true });
  if (!designated) await auth.setCustomUserClaims(uid, { demoReview: true });
  if (user.phoneNumber) await auth.updateUser(uid, { phoneNumber: null });
  await auth.revokeRefreshTokens(uid);
  const batch = db.batch();
  batch.update(profileRef, {
    demo: true, phoneNumber: FieldValue.delete(), phoneVerified: FieldValue.delete(),
    phoneVerifiedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
  });
  if (privateProfile.exists) batch.update(privateRef, {
    phoneNumber: FieldValue.delete(), phoneVerified: FieldValue.delete(),
    phoneVerifiedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  // Re-read eligibility immediately before enabling, including concurrent edits.
  const current = await auth.getUser(uid);
  const currentProfile = await profileRef.get();
  if (current.disabled || current.email || current.phoneNumber
    || current.customClaims?.demoReview !== true || Object.keys(current.customClaims).length !== 1
    || currentProfile.get('status') !== 'active' || currentProfile.get('demo') !== true) {
    throw new Error('Demo eligibility changed; fixed review remains disabled.');
  }
  await policyRef.set({
    signin: { fixedReview: { enabled: true, uid } }, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`Restored existing demo ${uid}. Phone: ${FIXED_REVIEW_PHONE}; code: ${FIXED_REVIEW_CODE}. No SMS. No expiry.`);
  console.log('Existing chats, contacts and wallet were preserved. Test the submitted iOS build before resubmitting.');
}

main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
