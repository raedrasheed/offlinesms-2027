// Per-conversation composer draft persistence (offline-safe).
//
// Drafts survive navigation and app restart. They are cleared once the message
// is queued or sent. Saving is debounced by the caller.

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'draft.v1.';

export async function getDraft(conversationId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(PREFIX + conversationId)) ?? '';
  } catch {
    return '';
  }
}

export async function setDraft(conversationId: string, text: string): Promise<void> {
  try {
    if (text && text.trim().length > 0) {
      await AsyncStorage.setItem(PREFIX + conversationId, text);
    } else {
      await AsyncStorage.removeItem(PREFIX + conversationId);
    }
  } catch {}
}

export async function clearDraft(conversationId: string): Promise<void> {
  try { await AsyncStorage.removeItem(PREFIX + conversationId); } catch {}
}
