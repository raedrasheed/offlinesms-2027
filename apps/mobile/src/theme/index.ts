import { colors, typography, radius, spacing } from '@offlinesms/design-tokens';
export { colors, typography, radius, spacing };

// React Native flavor of the same tokens (StyleSheet uses numbers, not strings)
export const theme = {
  colors,
  fonts: typography.fontFamily,
  radii: radius,
  space: spacing,
};
