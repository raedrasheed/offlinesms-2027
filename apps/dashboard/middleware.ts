import { NextResponse, type NextRequest } from 'next/server';
import { getHostRoute } from './lib/businessHost';

export function middleware(request: NextRequest) {
  const route = getHostRoute(request.headers.get('host'), request.nextUrl.pathname);
  if (route.kind === 'notFound') return new NextResponse(null, { status: 404 });
  return NextResponse.next();
}
