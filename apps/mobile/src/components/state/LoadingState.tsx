import { StateShell, StateShellProps } from './StateShell';

export type LoadingStateProps = Omit<StateShellProps, 'icon' | 'spinner' | 'tone'>;

export function LoadingState(props: LoadingStateProps) {
  return (
    <StateShell
      spinner
      tone="info"
      {...props}
      title={props.title ?? 'Loading…'}
    />
  );
}
