import { StateShell, StateShellProps } from './StateShell';

export type SuccessStateProps = Omit<StateShellProps, 'tone'>;

export function SuccessState(props: SuccessStateProps) {
  return (
    <StateShell
      tone="success"
      {...props}
      title={props.title ?? 'All done'}
    />
  );
}
