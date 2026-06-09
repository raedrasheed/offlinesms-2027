// Small "registered OfflineSMS user" badge for avatars (Phase 25).
//
// Placed top-right of an avatar, intentionally separate from the
// bottom-right online/presence dot so the two never collide. Renders the app
// logo only when `registered` is true; otherwise nothing.

import { memo } from 'react';
import { Image, View, StyleSheet } from 'react-native';

const LOGO = require('../../assets/icon.png');

type Props = {
  registered?: boolean;
  /** Badge diameter in px (defaults to a small ~16). */
  size?: number;
};

function RegisteredBadgeImpl({ registered, size = 16 }: Props) {
  if (!registered) return null;
  const d = size;
  return (
    <View
      style={[
        styles.wrap,
        { width: d, height: d, borderRadius: d / 2, top: -2, right: -2 },
      ]}
      pointerEvents="none"
      accessibilityElementsHidden
    >
      <Image source={LOGO} style={{ width: d - 3, height: d - 3, borderRadius: (d - 3) / 2 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});

export const RegisteredBadge = memo(RegisteredBadgeImpl);
