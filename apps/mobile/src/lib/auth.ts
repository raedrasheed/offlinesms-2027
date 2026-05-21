// Phone OTP flow (mobile primary)
import { signInWithPhoneNumber, RecaptchaVerifier, ConfirmationResult } from 'firebase/auth';
import { auth } from './firebase';
import { Platform } from 'react-native';

let confirmation: ConfirmationResult | null = null;

export async function sendOtp(phoneNumber: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Web uses invisible reCAPTCHA
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    confirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  } else {
    // Native uses Expo's deep-link based silent verification — simplified here.
    // For production add @react-native-firebase/auth which does native verification.
    throw new Error('Phone OTP on native requires @react-native-firebase/auth — see TODO');
  }
}

export async function verifyOtp(code: string) {
  if (!confirmation) throw new Error('No confirmation in flight — call sendOtp first');
  const cred = await confirmation.confirm(code);
  return cred.user;
}

export function signOut() {
  return auth.signOut();
}
