import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { activateConversation } from '../localdb/sync/syncScheduler';

/** Mounted navigation-stack screens are not necessarily visible/read by the user. */
export function useConversationVisibility(conversationId: string, focused: boolean): boolean {
  const [foreground, setForeground] = useState(AppState.currentState == null || AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  const active = focused && foreground;
  useEffect(() => {
    if (active && conversationId) return activateConversation(conversationId);
  }, [active, conversationId]);
  return active;
}
