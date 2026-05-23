import { AlertTriangle } from 'lucide-react';
import { StateShell, type StateShellProps } from './StateShell';

export type ErrorStateProps = Omit<StateShellProps, 'tone'>;

export function ErrorState(props: ErrorStateProps) {
  return (
    <StateShell
      icon={AlertTriangle}
      tone="error"
      {...props}
      title={props.title ?? 'Something went wrong'}
    />
  );
}
