import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useClipsCopy } from '../../lib/clipsCopy';
import type { PostItem } from '../../lib/posts';
import { postStatus, postStyles } from '../../screens/posts/postScreen';

export function PostCard({ post, onOpen, onProfile, onImageExpired }: { post: PostItem; onOpen?: () => void; onProfile: () => void; onImageExpired: (id: string) => void }) {
  const { colors } = useTheme(), { c, rtl } = useClipsCopy(), s = postStyles(colors, rtl);
  const [invalidImage, setInvalidImage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setInvalidImage(null); setNow(Date.now());
    if (!post.imageUrl) return;
    const timer = setTimeout(() => { setNow(Date.now()); onImageExpired(post.id); }, Math.max(0, post.imageExpiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [post.id, post.imageUrl, post.imageExpiresAtMs]);
  const image = post.imageUrl && post.imageUrl !== invalidImage && post.imageExpiresAtMs > Math.max(now, Date.now()) ? post.imageUrl : null;
  return <View style={s.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={post.author.displayName || c('Creator profile', 'الملف الشخصي للناشر')} onPress={onProfile} style={s.row}>
      {post.author.photoURL ? <Image source={{ uri: post.author.photoURL }} style={{ width: 42, height: 42, borderRadius: 21 }} />
        : <View style={[s.secondary, { width: 42, height: 42, borderRadius: 21, paddingHorizontal: 0 }]}><Ionicons name="person-outline" size={22} color={colors.text.muted} /></View>}
      <View style={{ flex: 1 }}><Text style={[s.body, { fontWeight: '700' }]}>{post.author.displayName || c('User', 'مستخدم')}</Text>
        <Text style={s.muted}>{post.author.username ? `@${post.author.username} · ` : ''}{postStatus(post, c)}</Text></View>
    </Pressable>
    <Pressable disabled={!onOpen} onPress={onOpen} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={onOpen ? c('Open post', 'فتح المنشور') : undefined}>
      {post.body ? <Text style={s.body}>{post.body}</Text> : null}
      {image ? <Image key={image} source={{ uri: image }} resizeMode="contain" style={{ width: '100%', aspectRatio: 1, marginTop: post.body ? 12 : 0, borderRadius: 12, backgroundColor: colors.background.subtle }}
        onError={() => setInvalidImage(image)} /> : post.imageUrl ? <View style={[s.empty, { backgroundColor: colors.background.subtle }]}><Ionicons name="image-outline" size={32} color={colors.text.muted} /><Text style={s.muted}>{invalidImage ? c('Could not load the image.', 'تعذّر تحميل الصورة.') : c('Refreshing image…', 'جارٍ تحديث الصورة…')}</Text>
          {invalidImage ? <Pressable accessibilityLabel={c('Retry image', 'إعادة تحميل الصورة')} onPress={() => { setInvalidImage(null); onImageExpired(post.id); }} style={s.secondary}><Text style={s.link}>{c('Retry image', 'إعادة تحميل الصورة')}</Text></Pressable> : null}</View> : null}
    </Pressable>
    {post.status === 'published' ? <Text style={s.muted}>{post.likeCount} {c('likes', 'إعجابات')} · {post.commentCount} {c('comments', 'تعليقات')}</Text> : <Text style={s.muted}>{post.moderationReason || c('Your post will appear after approval.', 'سيظهر منشورك بعد الموافقة عليه.')}</Text>}
  </View>;
}
