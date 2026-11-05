import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { MediaDimensions } from '../media/mediaDimensions';
import { videoDisplayDimensions } from '../media/mediaDimensions';

type Props = {
  uri: string;
  paused?: boolean;
  controls?: boolean;
  style?: StyleProp<ViewStyle>;
  nativeTestID?: string;
  onReady?: () => void;
  onDimensions?: (size: MediaDimensions) => void;
  onStatus?: (status: AVPlaybackStatus) => void;
  onError: () => void;
};
const STARTUP_MS = 25_000;
export function videoTime(ms: number) {
  const seconds = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A new URI owns a new native session, so late loads/commands cannot affect its replacement. */
export function VideoPlayer(props: Props) {
  return <VideoSession key={props.uri} {...props} />;
}

function VideoSession({ uri, paused = false, controls = true, style, nativeTestID, onReady, onDimensions, onStatus, onError }: Props) {
  const { t } = useTranslation();
  const player = useRef<Video>(null);
  const live = useRef(true), loaded = useRef(false), notified = useRef(false), failed = useRef(false);
  const lastRequested = useRef<boolean | null>(null);
  const command = useRef(0), started = useRef(false), lastPosition = useRef(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [userPaused, setUserPaused] = useState(false), [ended, setEnded] = useState(false);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false), [playing, setPlaying] = useState(false), [buffering, setBuffering] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null);
  const drag = useRef<number | null>(null), width = useRef(0), durationRef = useRef(0);
  const desired = !paused && active && !userPaused && scrub === null;
  const intent = useRef(desired);
  // Supersede in-flight command failures as soon as the desired state changes.
  if (intent.current !== desired) { intent.current = desired; command.current++; }
  const callbacks = useRef({ onReady, onDimensions, onStatus, onError });
  callbacks.current = { onReady, onDimensions, onStatus, onError };

  function clearWatchdog() { if (watchdog.current !== null) clearTimeout(watchdog.current); watchdog.current = null; }
  function fail() {
    if (!live.current || failed.current) return;
    failed.current = true; command.current++; clearWatchdog(); callbacks.current.onError();
  }
  function sync(positionMillis?: number, force = false) {
    if (!live.current || failed.current || !loaded.current || !player.current) return;
    if (!force && positionMillis === undefined && lastRequested.current === intent.current) return;
    lastRequested.current = intent.current;
    const version = ++command.current;
    try {
      void player.current.setStatusAsync({ shouldPlay: intent.current, ...(positionMillis === undefined ? {} : {
        positionMillis, seekMillisToleranceBefore: 0, seekMillisToleranceAfter: 0,
      }) }).catch(() => { if (live.current && version === command.current) fail(); });
    } catch { if (live.current && version === command.current) fail(); }
  }
  function ready() {
    if (!live.current || failed.current || notified.current) return;
    notified.current = true; callbacks.current.onReady?.();
  }
  function status(value: AVPlaybackStatus) {
    if (!live.current || failed.current) return;
    if (!value.isLoaded) { if (value.error) fail(); return; }
    loaded.current = true;
    setIsLoaded(true); setPlaying(value.isPlaying); setBuffering(value.isBuffering);
    const nextPosition = Number.isFinite(value.positionMillis) ? Math.max(0, value.positionMillis) : 0;
    const nextDuration = Number.isFinite(value.durationMillis) ? Math.max(0, value.durationMillis ?? 0) : 0;
    durationRef.current = nextDuration; setDuration(nextDuration);
    if (drag.current === null) setPosition(nextPosition);
    if (value.isPlaying && nextPosition > lastPosition.current) { started.current = true; clearWatchdog(); }
    lastPosition.current = nextPosition;
    if (value.didJustFinish && drag.current === null && intent.current) { intent.current = false; command.current++; setUserPaused(true); setEnded(true); clearWatchdog(); }
    callbacks.current.onStatus?.(value);
  }

  useEffect(() => {
    live.current = true;
    const listener = AppState.addEventListener('change', value => setActive(value === 'active'));
    return () => { live.current = false; command.current++; clearWatchdog(); listener.remove(); };
  }, []);
  useEffect(() => {
    sync(); clearWatchdog();
    if (desired && !started.current) watchdog.current = setTimeout(fail, STARTUP_MS);
    return clearWatchdog;
  }, [desired]);

  function toggle() {
    if (!live.current || failed.current || !loaded.current) return;
    // A tap on a stopped/loading first frame asks to start, rather than cancelling autoplay.
    const stop = !userPaused && !ended && (playing || started.current);
    setUserPaused(stop); setEnded(false);
    intent.current = !stop && !paused && active && drag.current === null;
    if (ended) { started.current = false; lastPosition.current = 0; setPosition(0); }
    sync(ended ? 0 : undefined, true);
  }
  function target(event: GestureResponderEvent) {
    return Math.max(0, Math.min(1, event.nativeEvent.locationX / width.current)) * durationRef.current;
  }
  function begin(event: GestureResponderEvent) {
    if (!loaded.current || !durationRef.current || width.current <= 0) return;
    const value = target(event); drag.current = value; setScrub(value);
    intent.current = false; sync(); clearWatchdog();
  }
  function move(event: GestureResponderEvent) {
    if (drag.current === null) return;
    const value = target(event); drag.current = value; setScrub(value);
  }
  function finish(event?: GestureResponderEvent) {
    if (drag.current === null) return;
    const value = event ? target(event) : position;
    drag.current = null; setScrub(null); setPosition(value); setEnded(false);
    intent.current = !userPaused && !paused && active;
    sync(value);
  }
  function accessibleSeek(action: string) {
    if (!loaded.current || !durationRef.current || (action !== 'increment' && action !== 'decrement')) return;
    const value = Math.max(0, Math.min(durationRef.current, position + (action === 'increment' ? 5000 : -5000)));
    setPosition(value); setEnded(false); sync(value);
  }
  const displayed = scrub ?? position;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, displayed / duration)) : 0;
  return <View style={style}>
    <Video ref={player} testID={nativeTestID} source={{ uri }} style={StyleSheet.absoluteFillObject}
      resizeMode={ResizeMode.CONTAIN} useNativeControls={false} shouldPlay={desired} progressUpdateIntervalMillis={250}
      onLoad={value => { status(value); if (value.isLoaded && live.current && !failed.current) { ready(); sync(undefined, true); } }}
      onReadyForDisplay={event => {
        if (!live.current || failed.current) return;
        const size = event?.naturalSize ? videoDisplayDimensions(event.naturalSize) : null;
        if (size) callbacks.current.onDimensions?.(size);
        ready();
      }} onPlaybackStatusUpdate={status} onError={fail} />
    {desired && (!isLoaded || buffering || !playing) ? <View pointerEvents="none" style={s.loading}><ActivityIndicator color="#fff" size="large" /></View> : null}
    {controls ? <View style={s.controls}>
      <Pressable testID="video-play-toggle" style={s.toggle} onPress={toggle} disabled={!isLoaded}
        accessibilityRole="button" accessibilityLabel={t(desired && (playing || started.current) ? 'videoPlayer.pause' : 'videoPlayer.play')}>
        <Ionicons name={desired && (playing || started.current) ? 'pause' : 'play'} size={25} color="#fff" />
      </Pressable>
      <Text style={s.time}>{videoTime(displayed)}</Text>
      <View testID="video-seek-bar" style={s.seek} accessible accessibilityRole="adjustable"
        accessibilityLabel={t('videoPlayer.seek')} accessibilityState={{ disabled: !isLoaded || duration <= 0 }}
        accessibilityValue={{ min: 0, max: Math.floor(duration / 1000), now: Math.floor(displayed / 1000), text: `${videoTime(displayed)} / ${videoTime(duration)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => accessibleSeek(event.nativeEvent.actionName)}
        onLayout={event => { width.current = event.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => isLoaded && duration > 0 && width.current > 0}
        onMoveShouldSetResponder={() => isLoaded && duration > 0 && width.current > 0}
        onResponderGrant={begin} onResponderMove={move} onResponderRelease={event => finish(event)}
        onResponderTerminate={() => finish()} onResponderTerminationRequest={() => false}>
        <View pointerEvents="none" style={s.track}><View style={[s.fill, { width: `${fraction * 100}%` }]} /></View>
        <View pointerEvents="none" style={[s.thumb, { left: `${fraction * 100}%` }]} />
      </View>
      <Text style={s.time}>{videoTime(duration)}</Text>
    </View> : null}
  </View>;
}

const s = StyleSheet.create({
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 64, paddingHorizontal: 8, flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.72)' },
  toggle: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  time: { color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'] },
  seek: { flex: 1, height: 48, justifyContent: 'center', direction: 'ltr' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#64727B', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: '#1AA9E4' },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff', marginLeft: -7, top: 17 },
});
