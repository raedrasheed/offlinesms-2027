import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../lib/firebase';
import type { ClipDataSaving } from '../lib/clipFeedModel';
export type ClipPreferences = { dataSaving: ClipDataSaving; muted: boolean };
const defaults: ClipPreferences = {dataSaving: 'auto', muted: true};
const listeners = new Set<() => void>();
export function useClipPreferences() {
  const uid = auth.currentUser?.uid ?? '';
  const key = `clips.preferences.v1:${uid}`;
  const [settings, setSettings] = useState<ClipPreferences>(defaults);
  useEffect(() => {
    let active = true;
    setSettings(defaults);
    const read = () => { void AsyncStorage.getItem(key).then(raw => {
      if (!active || auth.currentUser?.uid !== uid) return;
      const value = raw ? JSON.parse(raw) : {};
      setSettings({dataSaving: ['auto','always','never'].includes(value.dataSaving) ? value.dataSaving : 'auto', muted: value.muted !== false});
    }).catch(() => {}); };
    listeners.add(read); read();
    return () => { active = false; listeners.delete(read); };
  }, [key, uid]);
  const update = useCallback(async (patch: Partial<ClipPreferences>) => {
    const next = {...settings, ...patch};
    await AsyncStorage.setItem(key, JSON.stringify(next));
    if (auth.currentUser?.uid !== uid) return;
    setSettings(next); listeners.forEach(fn => fn());
  }, [key, uid, settings]);
  return {settings, update};
}
