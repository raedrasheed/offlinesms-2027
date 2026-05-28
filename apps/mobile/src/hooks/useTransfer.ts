// Subscribe a component to live media transfer progress for one message id.

import { useEffect, useState } from 'react';
import { getTransfer, subscribeTransfer, type TransferState } from '../media/transferProgress';

export function useTransfer(id: string | undefined): TransferState | undefined {
  const [state, setState] = useState<TransferState | undefined>(() => (id ? getTransfer(id) : undefined));
  useEffect(() => {
    if (!id) { setState(undefined); return; }
    setState(getTransfer(id));
    return subscribeTransfer((changed) => { if (changed === id) setState(getTransfer(id)); });
  }, [id]);
  return state;
}
