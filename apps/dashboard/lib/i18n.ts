// Central label map for admin UI strings.
//
// The dashboard is English-only for Phase 19. This module provides a single
// source of truth for navigation labels, page titles, and action labels so
// strings aren't scattered across JSX. A future phase can swap this for a
// proper i18n library without touching component code.

export const ADMIN_LABELS = {
  nav: {
    dashboard:     'Dashboard',
    users:         'Users',
    groups:        'Groups',
    sms:           'SMS',
    reports:       'Reports',
    support:       'Support',
    audit:         'Audit log',
    notifications: 'Notifications',
    settings:      'Settings',
    organizations: 'Organizations',
    packages:      'Packages',
  },
  actions: {
    export:   'Export CSV',
    search:   'Search',
    filter:   'Filter',
    assign:   'Assign',
    unassign: 'Unassign',
    resolve:  'Resolve',
    close:    'Close',
    reopen:   'Reopen',
    retry:    'Retry',
    refresh:  'Refresh',
  },
  status: {
    active:   'Active',
    frozen:   'Frozen',
    pending:  'Pending',
    resolved: 'Resolved',
    open:     'Open',
    closed:   'Closed',
    draft:    'Draft',
    sent:     'Sent',
    failed:   'Failed',
  },
} as const;
