import * as FS from 'expo-file-system';
import { mapTileUrl, type MapTile } from './locationMap';

// Map previews are disposable cache data, never permanent/backed-up documents.
const ROOT=FS.cacheDirectory ? `${FS.cacheDirectory}OfflineSMS/MapTiles/` : null;
const WEEK=7*24*60*60*1000;
const USER_AGENT='OfflineSMS/2.4.6 (+https://offlinesms.com)';
type Metadata={expiresAt:number;etag?:string;lastModified?:string};
const inflight=new Map<string,{promise:Promise<string|null>;viewers:Set<()=>boolean>}>();
let active=0;
const waiters:Array<()=>void>=[];
async function slot(){
  if(active>=3)await new Promise<void>(resolve=>waiters.push(resolve));else active++;
  return ()=>{const next=waiters.shift();if(next)next();else active--;};
}
/** Honor response caching/validators; use OSM's seven-day minimum fallback. */
export function tileMetadata(headers:Record<string,string>,now=Date.now()):Metadata {
  const h=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]));
  const maxAge=h['cache-control']?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1];
  const expires=Date.parse(h.expires ?? '');
  const age=Number(h.age)||0;
  const expiresAt=maxAge!==undefined ? now+Math.max(0,Number(maxAge)-age)*1000 : Number.isFinite(expires)?expires:now+WEEK;
  return {expiresAt,...(h.etag?{etag:h.etag}:{}),...(h['last-modified']?{lastModified:h['last-modified']}:{})};
}

/** Called only for a visible location bubble. Coalesced, bounded native requests. */
export async function cachedMapTile(tile:MapTile,stillVisible:()=>boolean):Promise<string|null> {
  // Browser images use the browser HTTP cache and its real Referer.
  if(!ROOT)return stillVisible()?mapTileUrl(tile):null;
  const current=inflight.get(tile.key);
  if(current){current.viewers.add(stillVisible);try{return await current.promise;}finally{current.viewers.delete(stillVisible);}}
  const viewers=new Set([stillVisible]);
  const visible=()=>[...viewers].some(isVisible=>isVisible());
  const path=`${ROOT}${tile.key}.png`,metadataPath=`${path}.json`,part=`${path}.part`;
  const task=(async()=>{
    let stale:string|null=null,release:(()=>void)|undefined;
    try {
      const info=await FS.getInfoAsync(path);
      if(info.exists && !info.isDirectory && info.size>0)stale=path;
      let metadata:Metadata|undefined;
      if(stale)try{metadata=JSON.parse(await FS.readAsStringAsync(metadataPath));}catch{}
      // A missing metadata file can follow an interrupted write; avoid re-fetching
      // a fresh tile just because the sidecar write did not finish.
      const expiresAt=metadata?.expiresAt ?? (info.exists?info.modificationTime*1000+WEEK:0);
      if(stale && expiresAt>Date.now())return stale;
      if(!visible())return stale;
      release=await slot();
      if(!visible())return stale;
      // The OS may purge this directory while the app is backgrounded.
      await FS.makeDirectoryAsync(ROOT!,{intermediates:true});
      const headers:Record<string,string>={'User-Agent':USER_AGENT};
      if(stale && metadata?.etag)headers['If-None-Match']=metadata.etag;
      if(stale && metadata?.lastModified)headers['If-Modified-Since']=metadata.lastModified;
      const result=await FS.downloadAsync(mapTileUrl(tile),part,{headers,sessionType:FS.FileSystemSessionType.FOREGROUND});
      // Some gateways return an error PNG with HTTP 200. Never cache/render it
      // as a map or place a coordinate pin over an access-denied notice.
      const responseHeaders=Object.fromEntries(Object.entries(result.headers).map(([k,v])=>[k.toLowerCase(),v]));
      if(responseHeaders['x-blocked'])return stale;
      if(result.status===304 && stale) {
        const fresh=tileMetadata(result.headers);
        await FS.writeAsStringAsync(metadataPath,JSON.stringify({...metadata,...fresh})).catch(()=>{});
        return stale;
      }
      if(result.status!==200 || !(result.mimeType || responseHeaders['content-type'] || '').toLowerCase().startsWith('image/'))return stale;
      const downloaded=await FS.getInfoAsync(part);
      if(!downloaded.exists || downloaded.isDirectory || downloaded.size<=0)return stale;
      await FS.moveAsync({from:part,to:path});
      await FS.writeAsStringAsync(metadataPath,JSON.stringify(tileMetadata(result.headers))).catch(()=>{});
      return path;
    } catch {return stale;}
    finally {release?.();await FS.deleteAsync(part,{idempotent:true}).catch(()=>{});}
  })();
  inflight.set(tile.key,{promise:task,viewers});
  try{return await task;}finally{viewers.delete(stillVisible);if(inflight.get(tile.key)?.promise===task)inflight.delete(tile.key);}
}
