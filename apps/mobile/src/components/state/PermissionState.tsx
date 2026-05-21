import { StateShell, StateShellProps } from './StateShell';

export type PermissionStateProps = Omit<StateShellProps, 'tone'>;

export function PermissionState(props: PermissionStateProps) {
  return (
    <StateShell
      tone="warning"
      title={props.title ?? 'No access'}
      description={
        props.description ?? 'Your account doesn’t have permission for this view.'
      }
      {...props}
    />
  );
}
