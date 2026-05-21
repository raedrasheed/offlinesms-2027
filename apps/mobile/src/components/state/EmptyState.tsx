import { StateShell, StateShellProps } from './StateShell';

export type EmptyStateProps = Omit<StateShellProps, 'tone'>;

export function EmptyState(props: EmptyStateProps) {
  return <StateShell tone="neutral" {...props} />;
}
