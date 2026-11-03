import { useEffect, useState } from 'react';
import {
  previewSmsEscalation, smsPreviewErrorCopy,
  type EscalationAudience, type EscalationPreview,
} from '../lib/sms';

type Input = {
  conversationId: string;
  messageId: string;
  audience: EscalationAudience;
  smsBody: string;
};

/** Never expose a quote for a different editor value, even during the render
 * before effect cleanup. Delayed responses cannot restore an obsolete quote. */
export function useSmsEscalationPreview(input: Input) {
  const { conversationId, messageId, audience } = input;
  const smsBody = input.smsBody.trim();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([conversationId, messageId, audience, smsBody, attempt]);
  const [state, setState] = useState<{
    key: string;
    preview: EscalationPreview | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      previewSmsEscalation({ conversationId, messageId, audience, smsBody })
        .then(preview => {
          // A new client must not show a price from an older deployed backend
          // that did not price the complete text or issue a confirmation token.
          if (typeof preview.finalSmsBody !== 'string'
              || !Number.isInteger(preview.smsSegments) || preview.smsSegments < 0
              || !['GSM-7', 'UCS-2'].includes(preview.smsEncoding)
              || !Number.isInteger(preview.smsUnits) || preview.smsUnits < 0
              || !Number.isFinite(preview.pointsPerRecipient) || preview.pointsPerRecipient < 0
              || typeof preview.quoteToken !== 'string' || !preview.quoteToken) {
            throw new Error('sms-preview-outdated');
          }
          if (!cancelled) setState({ key, preview, error: null });
        })
        .catch(error => {
          if (!cancelled) setState({ key, preview: null, error: smsPreviewErrorCopy(error) });
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [conversationId, messageId, audience, smsBody, attempt, key]);

  const current = state?.key === key ? state : null;
  return {
    preview: current?.preview ?? null,
    busy: !current,
    error: current?.error ?? null,
    refresh: () => setAttempt(value => value + 1),
  };
}
