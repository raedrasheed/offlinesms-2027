// Renders message text with tappable links. URLs (http/https and bare www.)
// are detected and rendered as pressable spans that open in the browser; the
// rest renders as normal text. Trailing punctuation is kept out of the link so
// "see https://x.com." doesn't swallow the period.

import { Text, Linking, TextStyle, StyleProp } from 'react-native';
import { colors } from '../theme';

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const TRAILING = /[.,;:!?)\]}'"»”]+$/;

function openUrl(raw: string) {
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  Linking.openURL(href).catch(() => { /* no handler / invalid */ });
}

export function LinkText({
  children, style, linkStyle,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
}) {
  const text = children ?? '';
  if (!text) return <Text style={style} />;

  const nodes: React.ReactNode[] = [];
  const re = new RegExp(URL_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    let url = m[0];
    // Peel trailing punctuation back into plain text.
    const trail = url.match(TRAILING)?.[0] ?? '';
    if (trail) url = url.slice(0, url.length - trail.length);
    const captured = url;
    nodes.push(
      <Text key={`l${key++}`} style={linkStyle ?? defaultLink} onPress={() => openUrl(captured)}>
        {url}
      </Text>,
    );
    if (trail) nodes.push(trail);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return <Text style={style}>{nodes}</Text>;
}

const defaultLink: TextStyle = { color: colors.primary, textDecorationLine: 'underline' };
