import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getClip, getClipThumbnails, type ClipItem } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';
import { useClipVisibility } from '../../hooks/useClipVisibility';

/** Protected metadata lives only while this card is visible. Recheck after
 * backgrounding, navigation and every short lease; chat history stores an ID. */
export function ClipMessageBubble({clipId, uid, visible, onOpen, onLongPress}: {
  clipId?: string | null; uid: string; visible: boolean;
  onOpen?: (id: string) => void; onLongPress: () => void;
}) {
  const {c} = useClipsCopy();
  const active = useClipVisibility() && visible;
  const key = `${uid}/${clipId ?? ''}`;
  const [state, setState] = useState<{key: string; clip: ClipItem | null; thumbnail: string | null; loading: boolean}>({key,clip:null,thumbnail:null,loading:false});
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({key,clip:null,thumbnail:null,loading:!!clipId && active});
    if (!active || !clipId || !uid) return;
    const resolve = async () => {
      // Expired or revoked content disappears before requesting a new lease.
      if (cancelled) return;
      setState({key,clip:null,thumbnail:null,loading:true});
      try {
        const clip = await getClip(clipId);
        const {items} = await getClipThumbnails([clipId]);
        if (cancelled) return;
        const lease = items.find(item => item.clipId === clipId);
        setState({key,clip,thumbnail:lease?.thumbnailUrl ?? null,loading:false});
        timer = setTimeout(() => { void resolve(); }, Math.max(1000, Math.min(90_000, (lease?.expiresAtMs ?? Date.now()+60_000)-Date.now())));
      } catch {
        if (!cancelled) setState({key,clip:null,thumbnail:null,loading:false});
      }
    };
    void resolve();
    return () => { cancelled=true; if(timer) clearTimeout(timer); };
  }, [clipId, uid, active, key]);
  // Gate synchronously, including the render before an effect clears state.
  const current = active && state.key === key;
  const clip = current ? state.clip : null;
  return <Pressable style={s.card} onPress={() => clipId && onOpen?.(clipId)} onLongPress={onLongPress}
    accessibilityRole="button" accessibilityLabel={c('Open video clip','فتح مقطع الفيديو')}>
    <View style={s.cover}>
      {current && state.thumbnail ? <Image source={{uri:state.thumbnail}} style={StyleSheet.absoluteFillObject} /> : null}
      {current && state.loading ? <ActivityIndicator color="#fff"/> : <Ionicons name="play-circle" size={46} color="#fff"/>}
    </View>
    <View style={s.info}>
      <Text style={s.title} numberOfLines={1}>{clip?.author.displayName || c('Video clip','مقطع فيديو')}</Text>
      <Text style={s.caption} numberOfLines={2}>{clip ? (clip.caption || c('Tap to watch','اضغط للمشاهدة')) : c('Open to check availability','افتح المقطع للتحقق من إمكانية المشاهدة')}</Text>
    </View>
  </Pressable>;
}
const s=StyleSheet.create({card:{width:235,borderRadius:15,overflow:'hidden'},cover:{height:220,backgroundColor:'#173548',alignItems:'center',justifyContent:'center'},info:{padding:11,backgroundColor:'#E3F1FA'},title:{fontSize:14,fontWeight:'700',color:'#102838'},caption:{fontSize:12,lineHeight:19,color:'#446071',marginTop:3}});
