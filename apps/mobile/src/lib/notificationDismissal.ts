/** Targeted notification-tray cleanup. Never clears another chat or an action notice. */
export type PresentedNotice = {
  date?: number;
  request: { identifier: string; content: { data?: unknown } };
};

export function createNotificationDismissal(deps: {
  list(): Promise<PresentedNotice[]>;
  dismiss(identifier: string): Promise<void>;
}) {
  return async (conversationId: string, options: {
    /** Only notifications for these messages when reading older history. */
    messageIds?: readonly string[];
    /** Capture before the async tray read so a later delivery remains unread. */
    readAt: number;
    isActive?: () => boolean;
  }): Promise<void> => {
    if (!conversationId || options.isActive?.() === false) return;
    const ids = options.messageIds ? new Set(options.messageIds) : null;
    if (ids?.size === 0) return;
    try {
      const notices = await deps.list();
      await Promise.all(notices.map(async notice => {
        if (options.isActive?.() === false) return;
        const data = notice.request.content.data;
        if (!data || typeof data !== 'object') return;
        const d = data as Record<string, unknown>;
        if (d.conversationId !== conversationId || (d.type != null && d.type !== 'chat_message')) return;
        if (ids) {
          if (typeof d.messageId !== 'string' || !ids.has(d.messageId)) return;
        } else if (typeof notice.date !== 'number' || notice.date > options.readAt) return;
        try { await deps.dismiss(notice.request.identifier); } catch { /* dismissed by the OS meanwhile */ }
      }));
    } catch { /* Tray access must never prevent reading messages. */ }
  };
}
