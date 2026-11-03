import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import type { PostItem } from '../../lib/posts';

export function usePostAccount() {
  const [uid, setUid] = useState(auth.currentUser?.uid ?? '');
  useEffect(() => onAuthStateChanged(auth, user => setUid(user?.uid ?? '')), []);
  return uid;
}
type Copy = (english: string, arabic: string) => string;
export function postStatus(post: PostItem, c: Copy) {
  return post.status === 'pending_review' ? c('Waiting for review', 'بانتظار المراجعة')
    : post.status === 'rejected' ? c('Not approved', 'لم تتم الموافقة')
      : post.status === 'removed' ? c('Removed', 'تمت الإزالة')
        : post.audience === 'private' ? c('Only me', 'أنا فقط')
          : post.audience === 'followers' ? c('Approved followers', 'المتابعون المقبولون') : c('Public', 'عام');
}
export function postFailure(error: unknown, c: Copy) {
  const value = error as { code?: string; message?: string };
  if (value?.message === 'clips-disabled' || value?.code === 'clips-disabled') return c('Posts are currently unavailable.', 'المنشورات غير متاحة حاليًا.');
  if (value?.code?.endsWith('permission-denied') || value?.code?.endsWith('not-found')) return c('This content is no longer available to you.', 'هذا المحتوى لم يعد متاحًا لك.');
  if (value?.code?.endsWith('resource-exhausted')) return c('The daily limit was reached. Try again later.', 'تم بلوغ الحد اليومي. حاول لاحقًا.');
  return c('Could not complete this request. Check your connection and try again.', 'تعذّر إكمال الطلب. تحقق من الاتصال وحاول مجددًا.');
}
export function postStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background.app },
    header: { paddingHorizontal: 16, paddingBottom: 12, gap: 12, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
    title: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    body: { color: colors.text.primary, fontSize: 16, lineHeight: 25, textAlign: rtl ? 'right' : 'left' },
    muted: { color: colors.text.muted, fontSize: 13, lineHeight: 20, textAlign: rtl ? 'right' : 'left' },
    row: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 },
    icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    button: { minHeight: 46, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.action.primary },
    buttonText: { color: colors.action.primaryFg, fontSize: 15, fontWeight: '700' },
    secondary: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.subtle },
    link: { color: colors.text.link, fontWeight: '700', fontSize: 14 },
    card: { padding: 16, borderRadius: 18, backgroundColor: colors.background.surface, borderWidth: 1, borderColor: colors.border.subtle, gap: 12 },
    input: { color: colors.text.primary, fontSize: 16, minHeight: 48, borderWidth: 1, borderColor: colors.border.default, borderRadius: 14, padding: 12, backgroundColor: colors.background.subtle, textAlign: rtl ? 'right' : 'left' },
    error: { color: colors.state.errorText, fontSize: 14, lineHeight: 22, paddingVertical: 10, textAlign: rtl ? 'right' : 'left' },
    empty: { padding: 24, gap: 16, alignItems: 'center' },
  });
}
