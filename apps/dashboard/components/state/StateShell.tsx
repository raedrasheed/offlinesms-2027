// Shared shell for all state primitives (Loading/Empty/Error/Permission/Success).
// Centralises layout so each variant is just an icon + tone + default copy.

import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

export type StateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type StateShellProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  primaryAction?: StateAction;
  secondaryAction?: StateAction;
  compact?: boolean;
  fullPage?: boolean;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  className?: string;
};

const toneIconBg: Record<NonNullable<StateShellProps['tone']>, string> = {
  neutral: 'bg-action-subtle text-action-subtleFg',
  info:    'bg-action-subtle text-action-subtleFg',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  error:   'bg-red-100 text-red-700',
};

function ActionButton({
  action,
  variant,
}: {
  action: StateAction;
  variant: 'primary' | 'secondary';
}) {
  const cls = clsx(
    'inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-semibold transition',
    variant === 'primary'
      ? 'bg-action-primary hover:bg-action-primaryHover text-action-primaryFg'
      : 'border border-border text-text-secondary hover:bg-bg-subtle'
  );
  if (action.href) {
    return (
      // Standard <a> — Next.js typed routes are not enforced for arbitrary actions.
      <a href={action.href} className={cls}>
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  );
}

export function StateShell({
  title,
  description,
  icon: Icon,
  iconClassName,
  primaryAction,
  secondaryAction,
  compact,
  fullPage,
  tone = 'neutral',
  className,
}: StateShellProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center text-center',
        fullPage && 'min-h-[60vh] justify-center',
        compact ? 'gap-2 py-6' : 'gap-3 py-12',
        className
      )}
      role="status"
    >
      {Icon && (
        <div
          className={clsx(
            'rounded-full grid place-items-center',
            compact ? 'w-10 h-10' : 'w-14 h-14',
            toneIconBg[tone],
            iconClassName
          )}
        >
          <Icon size={compact ? 18 : 22} />
        </div>
      )}
      <h2
        className={clsx(
          'font-extrabold tracking-tight text-text-primary',
          compact ? 'text-base' : 'text-lg'
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={clsx(
            'text-text-muted max-w-md',
            compact ? 'text-xs' : 'text-sm'
          )}
        >
          {description}
        </p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
          {primaryAction && <ActionButton action={primaryAction} variant="primary" />}
          {secondaryAction && <ActionButton action={secondaryAction} variant="secondary" />}
        </div>
      )}
    </div>
  );
}
