// Renders message text with highlighted, tappable @mentions. Plain runs are
// delegated to LinkText so URL detection still works inside a message that also
// contains mentions. When the message has no mentions this is a thin pass-through
// to LinkText.

import { Text, TextStyle, StyleProp } from 'react-native';
import { LinkText } from './LinkText';
import { renderMentionSegments } from '../lib/mentions';
import type { Mention } from '../lib/conversations';
import { colors } from '../theme';

export function MentionText({
  text, mentions, style, linkStyle, mentionStyle, onMentionPress,
}: {
  text: string;
  mentions?: Mention[] | null;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  mentionStyle?: StyleProp<TextStyle>;
  onMentionPress?: (userId: string) => void;
}) {
  const body = text ?? '';
  const segs = renderMentionSegments(body, mentions);

  // No mentions → defer entirely to LinkText.
  if (segs.length === 1 && segs[0].type === 'text') {
    return <LinkText style={style} linkStyle={linkStyle}>{body}</LinkText>;
  }

  return (
    <Text style={style}>
      {segs.map((seg, i) =>
        seg.type === 'mention' ? (
          <Text
            key={i}
            style={mentionStyle ?? defaultMention}
            onPress={onMentionPress ? () => onMentionPress(seg.userId) : undefined}
            suppressHighlighting
          >
            {seg.text}
          </Text>
        ) : (
          // Nested LinkText (no outer style) inherits the parent bubble style and
          // keeps URLs tappable within the plain runs.
          <LinkText key={i} linkStyle={linkStyle}>{seg.text}</LinkText>
        ),
      )}
    </Text>
  );
}

const defaultMention: TextStyle = { color: colors.primary, fontWeight: '700' };
