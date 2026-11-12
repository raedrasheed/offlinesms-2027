import { describe, expect, it } from 'vitest';
import { getHostRoute } from '../lib/businessHost';
import { BUSINESS_PAGES, businessDestination } from '../lib/businessRoutes';

describe('organization portal host routing', () => {
  it.each([
    ['/', '/business'],
    ['/login', '/business/login'],
    ['/register', '/business/register'],
    ['/groups', '/business/groups'],
    ['/send', '/business/send'],
    ['/activity/batch123', '/business/activity/batch123'],
    ['/integrations', '/business/integrations'],
  ])('serves %s through %s on the Business domain', (path, destination) => {
    expect(getHostRoute('Business.OfflineSMS.com:443', path)).toEqual({ kind: 'pass' });
    const pattern = path === '/activity/batch123' ? '/activity/:batchId' : path;
    expect(BUSINESS_PAGES).toContain(pattern);
    expect(businessDestination(pattern).replace(':batchId', 'batch123')).toBe(destination);
  });

  it.each(['/admin', '/admin/users', '/api/admin/reports', '/api/session', '/business/login'])(
    'blocks %s on the Business domain', path => {
      expect(getHostRoute('business.offlinesms.com', path)).toEqual({ kind: 'notFound' });
    },
  );

  it('keeps assets and existing API clients working', () => {
    for (const host of ['dash.offlinesms.com', 'business.offlinesms.com']) {
      expect(getHostRoute(host, '/api/v1/org/messages/send')).toEqual({ kind: 'pass' });
      expect(getHostRoute(host, '/_next/static/style.css')).toEqual({ kind: 'pass' });
    }
    expect(getHostRoute('dash.offlinesms.com', '/admin')).toEqual({ kind: 'pass' });
    expect(getHostRoute('dash.offlinesms.com', '/api/session')).toEqual({ kind: 'pass' });
  });

  it('limits internal Business pages and session endpoints to the intended host', () => {
    expect(getHostRoute('dash.offlinesms.com', '/business/groups')).toEqual({ kind: 'notFound' });
    expect(getHostRoute('dash.offlinesms.com', '/api/business/session')).toEqual({ kind: 'notFound' });
    expect(getHostRoute('business.offlinesms.com.example.net', '/api/business/session')).toEqual({ kind: 'notFound' });
    expect(getHostRoute('business.offlinesms.com', '/api/business/session')).toEqual({ kind: 'pass' });
    expect(getHostRoute('business.offlinesms.com', '/api/business/registration')).toEqual({ kind: 'pass' });
    expect(getHostRoute('dash.offlinesms.com', '/api/business/registration')).toEqual({ kind: 'notFound' });
  });
});
