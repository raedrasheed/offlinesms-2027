// Keyboard-safe wrapper for auth screens with a bottom CTA.
//
// Wraps content in a KeyboardAvoidingView + ScrollView so the login/submit
// button stays visible and tappable when the iOS / iPadOS keyboard is open
// (App Store Guideline 2.1), and so the keyboard can be dismissed by tapping
// outside an input. Content grows to fill the screen — a trailing `flex:1`
// spacer still pins the CTA to the bottom on tall iPhone/iPad layouts — and
// scrolls once the keyboard shrinks the available area.

import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { keyboardAvoidBehavior, AUTH_SCROLL_PROPS } from '../lib/keyboardLayout';

type Props = {
  children: ReactNode;
  /** Style for the scrollable content container (padding, etc.). */
  contentStyle?: StyleProp<ViewStyle>;
  /** Style for the outer KeyboardAvoidingView (e.g. background color). */
  style?: StyleProp<ViewStyle>;
};

export default function KeyboardAwareScreen({ children, contentStyle, style }: Props) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={keyboardAvoidBehavior(Platform.OS)}
    >
      <ScrollView
        contentContainerStyle={[{ flexGrow: 1 }, contentStyle]}
        {...AUTH_SCROLL_PROPS}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
