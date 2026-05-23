import { CheckCircle2 } from 'lucide-react';
import { StateShell, type StateShellProps } from './StateShell';

export type SuccessStateProps = Omit<StateShellProps, 'tone'>;

export function SuccessState(props: SuccessStateProps) {
  return (
    <StateShell
      icon={CheckCircle2}
      tone="success"
      {...props}
      title={props.title ?? 'All done'}
    />
  );
}
