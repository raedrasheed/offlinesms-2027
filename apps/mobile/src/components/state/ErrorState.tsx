import { StateShell, StateShellProps } from './StateShell';

export type ErrorStateProps = Omit<StateShellProps, 'tone'>;

export function ErrorState(props: ErrorStateProps) {
  return (
    <StateShell
      tone="error"
      {...props}
      title={props.title ?? 'Something went wrong'}
    />
  );
}
