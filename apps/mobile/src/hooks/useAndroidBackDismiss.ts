import { useCallback } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/** Dismiss an inline panel first; leave ordinary Back navigation to the navigator.
 * Native Modal windows use their own onRequestClose, before this listener. */
export function useAndroidBackDismiss(visible: boolean, onDismiss: () => void) {
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android' || !visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onDismiss]));
}
