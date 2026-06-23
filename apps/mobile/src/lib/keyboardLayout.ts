// Pure, render-free helpers for keyboard-safe screen layout (unit-testable; no
// react-native import so it loads under vitest). Used by KeyboardAwareScreen so
// the auth screens keep their bottom CTA reachable and dismissable when the iOS
// / iPadOS keyboard is open (App Store Guideline 2.1 — login button must not be
// hidden behind the keyboard).

export type KeyboardAvoidBehavior = 'padding' | 'height' | 'position' | undefined;

/**
 * KeyboardAvoidingView behavior per platform. iOS/iPadOS use 'padding' so the
 * content area shrinks and the bottom CTA is pushed above the keyboard; Android
 * resizes the window itself, so no behavior is needed.
 */
export function keyboardAvoidBehavior(os: string): KeyboardAvoidBehavior {
  return os === 'ios' ? 'padding' : undefined;
}

/**
 * Standard ScrollView props for an auth screen:
 *  - flexGrow content (applied by the component) lets a trailing spacer pin the
 *    CTA to the bottom on tall screens, yet the view scrolls once the keyboard
 *    shrinks the area so the CTA is always reachable;
 *  - `keyboardShouldPersistTaps:'handled'` → a tap outside an input dismisses the
 *    keyboard while taps on buttons still fire;
 *  - `keyboardDismissMode:'interactive'` → drag-to-dismiss the keyboard.
 */
export const AUTH_SCROLL_PROPS = {
  keyboardShouldPersistTaps: 'handled' as const,
  keyboardDismissMode: 'interactive' as const,
  showsVerticalScrollIndicator: false,
  bounces: false,
};
