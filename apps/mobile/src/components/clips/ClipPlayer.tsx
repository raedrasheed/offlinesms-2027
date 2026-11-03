import { useEffect, useRef, useState } from 'react';
import { View, Image, Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { getClipPlayback, recordClipView, type ClipItem, type ClipPlayback } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';

type Props = { clip: ClipItem; active: boolean; muted: boolean; quality: 'standard'|'dataSaver'; onMute: () => void; bottomInset?: number };
/** Only the visible, focused clip owns a native decoder or signed video URL.
 * Background/blur causes an immediate unmount, rather than merely muting it. */
export default function ClipPlayer({clip,active,muted,quality,onMute,bottomInset=0}:Props) {
  const {c} = useClipsCopy();
  const uid = auth.currentUser?.uid;
  const requestKey = `${uid}:${clip.id}:${quality}`;
  const [lease,setLease] = useState<{key:string;value:ClipPlayback}|null>(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [paused,setPaused] = useState(false);
  const [progress,setProgress] = useState(0);
  const [buffering,setBuffering] = useState(true);
  const viewed = useRef('');
  const expiryTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(() => {
    let live = true;
    setLease(null);setError(false);setPaused(false);setProgress(0);setBuffering(true);
    if(!active || !uid) return;
    void getClipPlayback({clipId:clip.id,quality}).then(value => {
      if(!live || auth.currentUser?.uid!==uid) return;
      if(!value.url || value.expiresAtMs <= Date.now()) throw new Error('playback-unavailable');
      setLease({key:requestKey,value});
      expiryTimer.current = setTimeout(() => {if(live)setAttempt(n=>n+1);},Math.max(1000,value.expiresAtMs-Date.now()-3000));
    }).catch(() => {if(live){setError(true);setBuffering(false);}});
    return () => {live=false;if(expiryTimer.current)clearTimeout(expiryTimer.current);};
  },[requestKey,active,attempt,clip.id,quality,uid]);
  const current = active && lease?.key===requestKey ? lease.value : null;
  function status(value:AVPlaybackStatus) {
    if(!active || !value.isLoaded) return;
    setBuffering(value.isBuffering);
    setProgress(value.durationMillis ? Math.min(1,value.positionMillis/value.durationMillis) : 0);
    if(value.isPlaying && value.positionMillis>=Math.min(2000,clip.durationMs || 2000) && viewed.current!==requestKey) {
      viewed.current=requestKey; void recordClipView(clip.id).catch(()=>{viewed.current='';});
    }
  }
  return <View style={s.root}>
    {current?.thumbnailUrl ? <Image source={{uri:current.thumbnailUrl}} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
    {active && current?.url && !error ? <Video key={requestKey+attempt} testID="clip-native-player" source={{uri:current.url}}
      style={StyleSheet.absoluteFill} resizeMode={ResizeMode.COVER} shouldPlay={!paused} isLooping isMuted={muted}
      progressUpdateIntervalMillis={250} onPlaybackStatusUpdate={status}
      onError={()=>{setError(true);setLease(null);setBuffering(false);}} /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={paused?c('Play video','تشغيل الفيديو'):c('Pause video','إيقاف الفيديو مؤقتًا')}
      testID="clip-toggle-play" style={StyleSheet.absoluteFill} onPress={()=>setPaused(v=>!v)} disabled={!current || error} />
    {active && !error && buffering ? <View pointerEvents="none" style={s.center}><ActivityIndicator size="large" color="#fff" /></View> : null}
    {paused && current && !error ? <View pointerEvents="none" style={s.center}><View style={s.play}><Ionicons name="play" size={42} color="#fff" /></View></View> : null}
    {active && error ? <View style={s.error}>
      <Ionicons name="cloud-offline-outline" size={36} color="#fff" />
      <Text style={s.errorTitle}>{c('This clip cannot be played right now','تعذر تشغيل المقطع الآن')}</Text>
      <Text style={s.errorBody}>{c('Check your connection. This clip may be private or no longer available.','تحقق من اتصالك. قد يكون المقطع خاصًا أو لم يعد متاحًا.')}</Text>
      <Pressable style={s.retry} onPress={()=>setAttempt(v=>v+1)}><Text style={s.retryText}>{c('Try again','إعادة المحاولة')}</Text></Pressable>
    </View> : null}
    {active && current ? <View style={[s.controls,{bottom:bottomInset+12}]}>
      <Pressable onPress={onMute} style={s.sound} accessibilityLabel={muted?c('Turn sound on','تشغيل الصوت'):c('Mute sound','كتم الصوت')}>
        <Ionicons name={muted?'volume-mute':'volume-high'} size={22} color="#fff" />
      </Pressable>
      <View style={s.track}><View style={[s.fill,{width:`${progress*100}%`}]} /></View>
      {quality==='dataSaver'?<Ionicons name="leaf-outline" size={15} color="#fff" accessibilityLabel={c('Data saver','توفير البيانات')} />:null}
    </View>:null}
  </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#0C141C'},center:{...StyleSheet.absoluteFillObject,alignItems:'center',justifyContent:'center'},play:{backgroundColor:'#0007',padding:18,borderRadius:50},error:{position:'absolute',top:'30%',left:40,right:40,alignItems:'center',gap:12},errorTitle:{color:'#fff',fontSize:18,fontWeight:'700',textAlign:'center'},errorBody:{color:'#B4C5D4',textAlign:'center',lineHeight:21},retry:{backgroundColor:'#1F7BA8',paddingHorizontal:25,paddingVertical:12,borderRadius:24},retryText:{color:'#fff',fontWeight:'700'},controls:{position:'absolute',left:18,right:18,flexDirection:'row',alignItems:'center',gap:12},sound:{padding:9,borderRadius:24,backgroundColor:'#0005'},track:{flex:1,height:3,borderRadius:2,backgroundColor:'#FFFFFF55',overflow:'hidden'},fill:{height:3,backgroundColor:'#70D1FF'}});
