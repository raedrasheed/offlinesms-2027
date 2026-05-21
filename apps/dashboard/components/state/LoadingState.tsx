import { Loader2 } from 'lucide-react';
import { StateShell, type StateShellProps } from './StateShell';

export type LoadingStateProps = Omit<StateShellProps, 'icon' | 'iconClassName' | 'tone'>;

export function LoadingState(props: LoadingStateProps) {
  return (
    <StateShell
      icon={Loader2}
      iconClassName="animate-spin"
      tone="info"
      title={props.title ?? 'Loading…'}
      {...props}
    />
  );
}
