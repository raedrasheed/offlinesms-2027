// ThemeContext — provides dark/light/system theme switching for mobile.
//
// Phase 19: reads user's preferredTheme from Firestore (via subscribeMe) and
// falls back to system (useColorScheme). Persists last-known theme to
// AsyncStorage to avoid a flash on cold start.
//
// Components should import `useTheme()` and use semantic color tokens.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightSemantic, darkSemantic } from '@offlinesms/design-tokens';
import type { ThemePreference } from '../lib/user';

const STORAGE_KEY = '@offlinesms/theme';

type SemanticColors = typeof lightSemantic.color | typeof darkSemantic.color;

type ThemeContextValue = {
  preference: ThemePreference;
  resolved:   'light' | 'dark';
  colors:     SemanticColors;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  preference:    'system',
  resolved:      'light',
  colors:        lightSemantic.color,
  setPreference: () => {},
});

export function ThemeProvider({
  children,
  userPreference,
}: {
  children: React.ReactNode;
  userPreference?: ThemePreference | null;
}) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [localPref, setLocalPref] = useState<ThemePreference>('system');

  // Load last-saved preference from AsyncStorage on mount (avoid flash).
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => {
        if (v === 'light' || v === 'dark' || v === 'system') setLocalPref(v);
      })
      .catch(() => {});
  }, []);

  // When Firestore user preference arrives, adopt it.
  useEffect(() => {
    if (userPreference != null) {
      setLocalPref(userPreference);
      AsyncStorage.setItem(STORAGE_KEY, userPreference).catch(() => {});
    }
  }, [userPreference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setLocalPref(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const resolved: 'light' | 'dark' =
    localPref === 'system'
      ? (systemScheme === 'dark' ? 'dark' : 'light')
      : localPref;

  const value = useMemo<ThemeContextValue>(() => ({
    preference:    localPref,
    resolved,
    colors:        resolved === 'dark' ? darkSemantic.color : lightSemantic.color,
    setPreference,
  }), [localPref, resolved, setPreference]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
