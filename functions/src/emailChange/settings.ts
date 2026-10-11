// Email-change switches (systemSettings/general):
//   emailChangeEnabled — the change's own switch, off unless set to true. It is
//     turned on only after the sign-in guards are deployed and verified, and
//     turning it off stops new changes without touching sign-in;
//   emailSignInEnabled — email sign-in; an address that can't sign in is
//     useless as a sign-in method, so the change needs it too.
// Off means no change starts and no new code is accepted. A change already
// accepted still finishes (verify retry, resume), so no account is left mid-way.

/** `enabled`: new email changes may start or be accepted (both switches on). */
export async function readEmailSettings(db: FirebaseFirestore.Firestore): Promise<{ enabled: boolean; supportEmail: string | null }> {
  const snap = await db.collection('systemSettings').doc('general').get();
  const d = snap.exists ? snap.data()! : {};
  return {
    enabled: d.emailSignInEnabled === true && d.emailChangeEnabled === true,
    supportEmail: (d.supportEmail as string | undefined)?.trim() || null,
  };
}
