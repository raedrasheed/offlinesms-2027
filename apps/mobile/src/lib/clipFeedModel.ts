import type { ClipItem, ClipPage, ClipFeedInput } from './clips';
export type ClipDataSaving = 'auto' | 'always' | 'never';
export function clipQuality(mode: ClipDataSaving, networkType: string | null | undefined): 'standard' | 'dataSaver' {
  return mode === 'always' || (mode === 'auto' && networkType !== 'wifi' && networkType !== 'ethernet') ? 'dataSaver' : 'standard';
}
export function appendUniqueClips(before: ClipItem[], next: ClipItem[]): ClipItem[] {
  const byId = new Map(before.map(item => [item.id, item]));
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()];
}
/** Authorization filters may produce an empty page with a valid cursor. Scan
 * a bounded number in one UI request, then expose Load more instead of hiding
 * remaining content or spinning indefinitely for a large blocked roster. */
export async function loadClipWindow(
  load: (input: ClipFeedInput) => Promise<ClipPage<ClipItem>>,
  input: ClipFeedInput,
  isCurrent: () => boolean = () => true,
): Promise<ClipPage<ClipItem>> {
  let cursor = input.cursor;
  const visited = new Set<string>();
  for (let scan = 0; scan < 4; scan++) {
    if (!isCurrent()) return {items: [], nextCursor: null};
    const page = await load({...input, ...(cursor ? {cursor} : {})});
    if (!isCurrent()) return {items: [], nextCursor: null};
    if (page.items.length || !page.nextCursor) return page;
    if (visited.has(page.nextCursor)) return {items: [], nextCursor: null};
    visited.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return {items: [], nextCursor: cursor ?? null};
}
