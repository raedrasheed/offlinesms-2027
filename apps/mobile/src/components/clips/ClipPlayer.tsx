import { useEffect, useRef, useState } from 'react';
import { View, Image, Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { getClipPlayback, recordClipView, type ClipItem, type ClipPlayback } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';

type Props = { clip: ClipItem; active: boolean; muted: boolean; quality: 'standard'|'dataSaver'; onMute: () => void; bottomInset?: number };
type PlaybackContext = { requestKey: string; active: boolean; attempt: number };
type PlaybackRun = {
  context: PlaybackContext;
  uid: string;
  live: boolean;
  loaded: boolean;
  playing: boolean;
  paused: boolean;
  command: number;
  position: number;
  watchdog: ReturnType<typeof setTimeout> | null;
  expiry: ReturnType<typeof setTimeout> | null;
};
type PlaybackFailure = 'timeout' | 'unavailable' | 'native';
const STARTUP_TIMEOUT_MS = 25_000;

/** Only the visible, focused clip owns a native decoder or signed video URL.
 * Background/blur causes an immediate unmount, rather than merely muting it. */
export default function ClipPlayer({clip,active,muted,quality,onMute,bottomInset=0}:Props) {
  const { c } = useClipsCopy();
  const uid = auth.currentUser?.uid;
  const intentKey = `${uid}:${clip.id}`;
  const requestKey = `${uid}:${clip.id}:${quality}`;
  const [lease, setLease] = useState<{ run: PlaybackRun; value: ClipPlayback } | null>(null);
  const [failure, setFailure] = useState<{ context: PlaybackContext; kind: PlaybackFailure } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const player = useRef<Video>(null);
  const viewed = useRef('');
  const contextRef = useRef<PlaybackContext>({ requestKey, active, attempt });
  const intent = useRef({ key: intentKey, active, paused: false });

  // Invalidate callbacks during render, before the previous effect cleans up.
  if (contextRef.current.requestKey !== requestKey || contextRef.current.active !== active || contextRef.current.attempt !== attempt) {
    contextRef.current = { requestKey, active, attempt };
  }
  if (intent.current.key !== intentKey || intent.current.active !== active) {
    intent.current = { key: intentKey, active, paused: false };
  }
  const context = contextRef.current;

  function isCurrent(run: PlaybackRun) {
    return run.live && contextRef.current === run.context && run.context.active && auth.currentUser?.uid === run.uid;
  }
  function clearWatchdog(run: PlaybackRun) {
    if (run.watchdog !== null) clearTimeout(run.watchdog);
    run.watchdog = null;
  }
  function clearTimers(run: PlaybackRun) {
    clearWatchdog(run);
    if (run.expiry !== null) clearTimeout(run.expiry);
    run.expiry = null;
  }
  function fail(run: PlaybackRun, kind: PlaybackFailure) {
    if (!isCurrent(run)) return;
    run.live = false;
    clearTimers(run);
    setLease(null);
    setFailure({ context: run.context, kind });
    setPlaying(false);
    setBuffering(false);
  }
  function startWatchdog(run: PlaybackRun) {
    if (run.watchdog !== null) return;
    run.watchdog = setTimeout(() => fail(run, 'timeout'), STARTUP_TIMEOUT_MS);
  }

  useEffect(() => {
    setLease(null);
    setFailure(null);
    setPaused(intent.current.paused);
    setPlaying(false);
    setProgress(0);
    setBuffering(!intent.current.paused);
    if (!active || !uid) return;
    const run: PlaybackRun = {
      context, uid, live: true, loaded: false, playing: false,
      paused: intent.current.paused, command: 0, position: 0, watchdog: null, expiry: null,
    };
    startWatchdog(run);
    void getClipPlayback({clipId:clip.id,quality}).then(value => {
      if (!isCurrent(run)) return;
      if (!value.url || value.expiresAtMs <= Date.now()) {
        fail(run, 'unavailable');
        return;
      }
      clearWatchdog(run);
      if (!run.paused) startWatchdog(run);
      setLease({ run, value });
      run.expiry = setTimeout(() => {
        if (isCurrent(run)) setAttempt(n => n + 1);
      }, Math.max(1000, value.expiresAtMs - Date.now() - 3000));
    }).catch(() => fail(run, 'unavailable'));
    return () => {
      run.live = false;
      clearTimers(run);
    };
  }, [context]);

  const current = lease && isCurrent(lease.run) ? lease : null;
  const error = active && failure?.context === context ? failure.kind : null;

  function status(run: PlaybackRun, value: AVPlaybackStatus) {
    if (!isCurrent(run)) return;
    if (!value.isLoaded) {
      if (value.error) fail(run, 'native');
      return;
    }
    run.loaded = true;
    run.playing = value.isPlaying;
    setPlaying(value.isPlaying);
    setBuffering(!run.paused && (value.isBuffering || !value.isPlaying));
    setProgress(value.durationMillis ? Math.min(1,value.positionMillis/value.durationMillis) : 0);
    // A loaded poster or a first-frame event is not evidence of moving video.
    if (run.paused || (value.isPlaying && value.positionMillis > run.position)) clearWatchdog(run);
    run.position = value.positionMillis;
    if (!run.paused && value.isPlaying && value.positionMillis >= Math.min(2000, clip.durationMs || 2000) && viewed.current !== requestKey) {
      viewed.current = requestKey;
      void recordClipView(clip.id).catch(() => {
        if (isCurrent(run) && viewed.current === requestKey) viewed.current = '';
      });
    }
  }
  function syncPlayback(run: PlaybackRun) {
    if (!isCurrent(run) || !run.loaded || !player.current) return;
    const command = ++run.command;
    try {
      const operation = run.paused ? player.current.pauseAsync() : player.current.playAsync();
      void operation.catch(() => {
        if (isCurrent(run) && run.command === command) fail(run, 'native');
      });
    } catch {
      if (isCurrent(run) && run.command === command) fail(run, 'native');
    }
  }
  function togglePlayback() {
    if (!current || !isCurrent(current.run)) return;
    const run = current.run;
    // Tapping a loading/stopped poster asks to play; it must not cancel autoplay.
    run.paused = !run.paused && run.playing;
    intent.current.paused = run.paused;
    run.command++;
    setPaused(run.paused);
    if (run.paused) {
      clearWatchdog(run);
      setBuffering(false);
    } else {
      startWatchdog(run);
      setBuffering(!run.playing);
    }
    syncPlayback(run);
  }
  function retry() {
    if (contextRef.current !== context || !active || auth.currentUser?.uid !== uid) return;
    intent.current.paused = false;
    setAttempt(n => n + 1);
  }
  return <View style={s.root}>
    {current?.value.thumbnailUrl ? <Image source={{uri:current.value.thumbnailUrl}} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
    {current?.value.url && !error ? <Video ref={player} key={requestKey+attempt} testID="clip-native-player" source={{uri:current.value.url}}
      style={StyleSheet.absoluteFill} resizeMode={ResizeMode.COVER} shouldPlay={!paused} isLooping isMuted={muted}
      progressUpdateIntervalMillis={250} onPlaybackStatusUpdate={value => status(current.run, value)}
      onLoad={value => { status(current.run, value); syncPlayback(current.run); }}
      onError={() => fail(current.run, 'native')} /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={!paused && playing?c('Pause video','إيقاف الفيديو مؤقتًا'):c('Play video','تشغيل الفيديو')}
      testID="clip-toggle-play" style={StyleSheet.absoluteFill} onPress={togglePlayback} disabled={!current || !!error} />
    {active && !error && buffering ? <View pointerEvents="none" style={s.center}><ActivityIndicator size="large" color="#fff" /></View> : null}
    {paused && current && !error ? <View pointerEvents="none" style={s.center}><View style={s.play}><Ionicons name="play" size={42} color="#fff" /></View></View> : null}
    {active && error ? <View style={s.error}>
      <Ionicons name="cloud-offline-outline" size={36} color="#fff" />
      <Text style={s.errorTitle}>{c('This clip cannot be played right now','تعذر تشغيل المقطع الآن')}</Text>
      <Text style={s.errorBody}>{error === 'timeout'
        ? c('The clip took too long to start. Check your connection and try again.','استغرق بدء المقطع وقتًا طويلًا. تحقق من اتصالك وحاول مجددًا.')
        : c('Try again. If the clip still cannot play, check your connection.','حاول مجددًا. إذا استمر تعذر تشغيل المقطع، تحقق من اتصالك.')}</Text>
      <Pressable testID="clip-retry" style={s.retry} onPress={retry}><Text style={s.retryText}>{c('Try again','إعادة المحاولة')}</Text></Pressable>
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

