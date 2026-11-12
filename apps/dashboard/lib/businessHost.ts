import { BUSINESS_HOST, BUSINESS_PAGES } from './businessRoutes';
export const BUSINESS_URL = `https://${BUSINESS_HOST}`;

type HostRoute = { kind: 'pass' | 'notFound' };

export function getHostRoute(host: string | null, path: string): HostRoute {
  const isBusiness = host?.toLowerCase().replace(/:\d+$/, '') === BUSINESS_HOST;
  if (!isBusiness) {
    const internal = path === '/business' || path.startsWith('/business/')
      || path === '/api/business' || path.startsWith('/api/business/');
    return { kind: internal ? 'notFound' : 'pass' };
  }

  if (BUSINESS_PAGES.some(page => page === '/activity/:batchId' ? /^\/activity\/[^/]+$/.test(path) : page === path)) {
    return { kind: 'pass' };
  }

  if (path === '/api/business/session' || path === '/api/business/registration' || path.startsWith('/api/v1/org/')
      || path === '/logo.png' || path === '/favicon.ico'
      || path === '/_next/image' || path.startsWith('/_next/static/')) {
    return { kind: 'pass' };
  }

  return { kind: 'notFound' };
}
