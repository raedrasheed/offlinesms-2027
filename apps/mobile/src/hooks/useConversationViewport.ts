import { useCallback, useEffect, useRef, useState } from 'react';

type Row = { id: string; senderUid?: string; senderId?: string };
type List = {
  scrollToOffset(options: { offset: number; animated: boolean }): void;
  scrollToIndex(options: { index: number; animated: boolean; viewPosition: number }): void;
};

/** Navigation intent wins over cached position; pagination never moves a history reader. */
export function useConversationViewport(options: {
  conversationId: string;
  uid: string;
  active: boolean;
  focused: boolean; // navigation focus; app backgrounding alone must not lose history
  rows: readonly Row[]; // inverted, newest first
  focusMessageId?: string;
  list: { current: List | null };
  consumeFocus(messageId: string): void;
}) {
  const current = useRef(options);
  current.current = options;
  const nearLatest = useRef(true);
  const newest = useRef<string | undefined>(undefined);
  const located = useRef<string | undefined>(undefined);
  const opening = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const locate = useCallback((animated: boolean) => {
    const ctx = current.current;
    if (!ctx.active || !ctx.rows.length || !ctx.list.current) return;
    if (ctx.focusMessageId) {
      const index = ctx.rows.findIndex(row => row.id === ctx.focusMessageId);
      if (index < 0 || located.current === ctx.focusMessageId) return;
      located.current = ctx.focusMessageId;
      opening.current = false;
      setHighlightId(ctx.focusMessageId);
      if (index === 0) ctx.list.current.scrollToOffset({ offset: 0, animated });
      else ctx.list.current.scrollToIndex({ index, animated, viewPosition: 0.5 });
    } else if (opening.current) {
      opening.current = false;
      ctx.list.current.scrollToOffset({ offset: 0, animated });
    }
  }, []);

  useEffect(() => {
    newest.current = undefined;
    located.current = undefined;
    setHighlightId(null);
  }, [options.conversationId]);

  useEffect(() => {
    if (!options.focused) return;
    opening.current = true;
    nearLatest.current = true;
    setShowScrollDown(false);
    // A new focus session can reuse a mounted FlatList and its old offset.
    const frame = requestAnimationFrame(() => locate(false));
    return () => cancelAnimationFrame(frame);
  }, [options.focused, options.conversationId, locate]);

  useEffect(() => {
    located.current = undefined;
    if (!options.focusMessageId) return;
    const frame = requestAnimationFrame(() => locate(true));
    return () => cancelAnimationFrame(frame);
  }, [options.focusMessageId, locate]);

  useEffect(() => {
    if (!options.active || !options.rows.length) return;
    const frame = requestAnimationFrame(() => {
      const ctx = current.current;
      if (!ctx.active || ctx.conversationId !== options.conversationId) return;
      const first = ctx.rows[0];
      if (!first) return;
      const previous = newest.current;
      newest.current = first.id;
      if (ctx.focusMessageId || opening.current) { locate(false); return; }
      if (!previous || previous === first.id) return;
      if (first.senderUid === ctx.uid || first.senderId === ctx.uid || nearLatest.current) {
        ctx.list.current?.scrollToOffset({ offset: 0, animated: true });
      } else setShowScrollDown(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [options.rows, options.active, options.conversationId, options.focusMessageId, locate]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const onScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    nearLatest.current = event.nativeEvent.contentOffset.y <= 80;
    setShowScrollDown(!nearLatest.current);
  }, []);
  const onLayout = useCallback(() => locate(false), [locate]);
  const onVisible = useCallback((ids: readonly string[]) => {
    const ctx = current.current;
    if (ctx.active && ctx.focusMessageId && ids.includes(ctx.focusMessageId)) {
      opening.current = false;
      ctx.consumeFocus(ctx.focusMessageId);
    }
  }, []);
  const scrollToBottom = useCallback(() => {
    nearLatest.current = true;
    opening.current = false;
    setShowScrollDown(false);
    current.current.list.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  return { onScroll, onLayout, onVisible, scrollToBottom, showScrollDown, highlightId };
}
