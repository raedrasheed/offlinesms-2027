// PIN: hashed at rest with a per-user salt. Stored as users/{uid}.pinHash.
//
// This is a *second-device confirmation* factor, not a primary password —
// we use SHA-256 (via expo-crypto) plus a random per-user salt. The salt
// is stored alongside the hash; rotating it requires resetting the PIN.

import * as Crypto from 'expo-crypto';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, saltHex: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${saltHex}:${pin}`,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

export async function setPin(pin: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not-signed-in');
  if (!/^\d{6}$/.test(pin)) throw new Error('pin-must-be-6-digits');
  const salt = bytesToHex(await Crypto.getRandomBytesAsync(16));
  const pinHash = await hashPin(pin, salt);
  await setDoc(
    doc(db, 'users', uid),
    { pinSalt: salt, pinHash, pinSetAt: serverTimestamp() },
    { merge: true },
  );
}

export async function verifyPin(pin: string): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.data() as { pinSalt?: string; pinHash?: string } | undefined;
  if (!data?.pinSalt || !data?.pinHash) return false;
  const test = await hashPin(pin, data.pinSalt);
  return test === data.pinHash;
}

export async function hasPin(): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  const snap = await getDoc(doc(db, 'users', uid));
  return Boolean(snap.exists() && (snap.data() as { pinHash?: string }).pinHash);
}
