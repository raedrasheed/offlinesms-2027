import { StateShell, StateShellProps } from './StateShell';

export type SuccessStateProps = Omit<StateShellProps, 'tone'>;

export function SuccessState(props: SuccessStateProps) {
  return (
    <StateShell
      tone="success"
      title={props.title ?? 'All done'}
      {...props}
    />
  );
}
