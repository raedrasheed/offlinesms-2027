// Restore the existing seeded App Review account without sending SMS or
// resetting its chats/wallet. Requires Admin SDK credentials for --project.
// Usage: npx tsx scripts/restoreFixedReview.ts --project=offlinesms-prod-2027
// Optional: --uid=<already-designated-demo-uid> or --disable.
// To designate an operator-confirmed existing test account explicitly:
// --designate-existing-demo --uid=<test account uid>
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { FIXED_REVIEW_PHONE, FIXED_REVIEW_CODE } from '../functions/src/phoneAuth/fixedReview';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function hasValue(value: unknown): boolean {
  if (value == null || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function assertProfileIdentity(data: FirebaseFirestore.DocumentData | undefined, explicitDesignation: boolean) {
  if (data?.email || (data?.phoneNumber && data.phoneNumber !== FIXED_REVIEW_PHONE)) {
    throw new Error('Refusing: demo profile contains another identity.');
  }
  if (explicitDesignation && data) {
    const privileged = ['admin', 'isAdmin', 'roles', 'permissions', 'organizationId', 'organizationRole', 'businessId'];
    if ((hasValue(data.role) && !['user', 'member'].includes(data.role))
      || privileged.some(key => hasValue(data[key]))) {
      throw new Error('Refusing: demo profile contains privileged or organization access.');
    }
  }
}

async function main() {
  const projectId = arg('project');
  if (!projectId) throw new Error('Pass --project=<Firebase project id>.');
  const explicitDesignation = process.argv.includes('--designate-existing-demo');
  const explicitUid = arg('uid');
  if (explicitDesignation && (!explicitUid?.trim() || process.argv.includes('--disable'))) {
    throw new Error('Use --designate-existing-demo with an explicit --uid=<test account uid>, without --disable.');
  }
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
  let uid = explicitUid || policy.get('signin.fixedReview.uid');
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
  const explicitlySelected = explicitDesignation && Object.keys(claims).length === 0
    && user.phoneNumber === FIXED_REVIEW_PHONE;
  const legacy = Object.keys(claims).length === 0 && user.phoneNumber === FIXED_REVIEW_PHONE
    && profile.get('displayName') === 'OfflineSMS Reviewer'
    && profile.get('username') === 'reviewer'
    && profile.get('about') === 'App Review demo account';
  if (user.disabled || user.email || !profile.exists || profile.get('status') !== 'active'
    || (!designated && !legacy && !explicitlySelected)
    || (user.phoneNumber && user.phoneNumber !== FIXED_REVIEW_PHONE)) {
    throw new Error('Refusing: account is not an active, unprivileged designated/legacy App Review demo.');
  }
  if (explicitDesignation && (user.tenantId || user.multiFactor?.enrolledFactors.length
    || user.providerData.some(provider => provider.providerId !== 'phone'))) {
    throw new Error('Refusing: test account has another sign-in provider, tenant or enrolled factor.');
  }
  for (const data of [profile.data(), privateProfile.data()]) assertProfileIdentity(data, explicitDesignation);

  // Stage while disabled; a failed/interrupted migration cannot open access.
  // This does not alter the SMS master/stop/purpose/relay settings.
  await db.runTransaction(async tx => {
    const [currentPolicy, currentProfile, currentPrivate] = await Promise.all([
      tx.get(policyRef), tx.get(profileRef), tx.get(privateRef),
    ]);
    const boundUid = currentPolicy.get('signin.fixedReview.uid');
    if (explicitDesignation && boundUid && boundUid !== uid) {
      throw new Error('Refusing: fixed review is already bound to another account.');
    }
    if (!currentProfile.exists || currentProfile.get('status') !== 'active') {
      throw new Error('Refusing: demo profile is no longer active.');
    }
    for (const data of [currentProfile.data(), currentPrivate.data()]) assertProfileIdentity(data, explicitDesignation);
    tx.set(policyRef, { signin: { fixedReview: { enabled: false, uid } } }, { merge: true });
  });
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
  if (current.disabled || current.email || current.phoneNumber
    || current.customClaims?.demoReview !== true || Object.keys(current.customClaims).length !== 1
    || (explicitDesignation && (current.tenantId || current.multiFactor?.enrolledFactors.length
      || current.providerData.some(provider => provider.providerId !== 'phone')))) {
    throw new Error('Demo eligibility changed; fixed review remains disabled.');
  }
  await db.runTransaction(async tx => {
    const [currentPolicy, currentProfile, currentPrivate] = await Promise.all([
      tx.get(policyRef), tx.get(profileRef), tx.get(privateRef),
    ]);
    if (currentPolicy.get('signin.fixedReview.uid') !== uid
      || currentProfile.get('status') !== 'active' || currentProfile.get('demo') !== true) {
      throw new Error('Demo eligibility or binding changed; this operation will not enable access.');
    }
    for (const data of [currentProfile.data(), currentPrivate.data()]) assertProfileIdentity(data, explicitDesignation);
    tx.set(policyRef, {
      signin: { fixedReview: { enabled: true, uid } }, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  console.log(`Restored existing demo ${uid}. Phone: ${FIXED_REVIEW_PHONE}; code: ${FIXED_REVIEW_CODE}. No SMS. No expiry.`);
  console.log('Existing chats, contacts and wallet were preserved. Test the submitted iOS build before resubmitting.');
}

main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
