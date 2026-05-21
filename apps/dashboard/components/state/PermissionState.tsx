import { ShieldOff } from 'lucide-react';
import { StateShell, type StateShellProps } from './StateShell';

export type PermissionStateProps = Omit<StateShellProps, 'tone'>;

export function PermissionState(props: PermissionStateProps) {
  return (
    <StateShell
      icon={ShieldOff}
      tone="warning"
      title={props.title ?? 'You don’t have access to this page'}
      description={
        props.description ??
        'Your account doesn’t carry an admin role. Ask an administrator to grant access, then reload.'
      }
      {...props}
    />
  );
}
