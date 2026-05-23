import { Inbox } from 'lucide-react';
import { StateShell, type StateShellProps } from './StateShell';

export type EmptyStateProps = Omit<StateShellProps, 'tone'>;

export function EmptyState(props: EmptyStateProps) {
  return <StateShell icon={Inbox} tone="neutral" {...props} />;
}
