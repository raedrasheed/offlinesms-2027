import * as FS from 'expo-file-system';
import {Platform} from 'react-native';
import {fromByteArray,toByteArray} from 'base64-js';
import {MAP_SOURCE_URL,mapTileUrl,parseMapSource,type MapSource,type MapTile} from './locationMap';
import {decodeMapTile} from './vectorMap';
import type {VectorTile} from '@mapbox/vector-tile';

const ROOT=FS.cacheDirectory?`${FS.cacheDirectory}OfflineSMS/MapVectors/`:null;
const USER_AGENT='OfflineSMS/2.4.7 (+https://offlinesms.com)';
const headers=Platform.OS==='web'?undefined:{'User-Agent':USER_AGENT};
let source:MapSource|null=null,sourceLoad:Promise<MapSource|null>|undefined,lastSourceAttempt=0;
const inflight=new Map<string,{promise:Promise<VectorTile|null>;viewers:Set<()=>boolean>}>();
let active=0;const waiters:Array<()=>void>=[];
async function slot(){
  if(active>=3)await new Promise<void>(resolve=>waiters.push(resolve));else active++;
  return ()=>{const next=waiters.shift();if(next)next();else active--;};
}
async function request(url:string,json:boolean):Promise<unknown> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(url,{headers,signal:controller.signal,credentials:'omit'});
    if(!response.ok || response.headers.get('x-blocked'))throw Error('map-unavailable');
    if(json)return await response.json();
    if(Number(response.headers.get('content-length'))>4*1024*1024)throw Error('map-data-too-large');
    return new Uint8Array(await response.arrayBuffer());
  }finally{clearTimeout(timer);}
}
async function readSource():Promise<MapSource|null>{
  if(source)return source;
  if(ROOT)try{
    const saved=JSON.parse(await FS.readAsStringAsync(`${ROOT}source.json`));
    const valid=parseMapSource({tiles:[saved.template],maxzoom:14});
    source={...valid,expiresAt:Number(saved.expiresAt)||0};
  }catch{}
  return source;
}
function refreshSource():Promise<MapSource|null>{
  if(sourceLoad)return sourceLoad;
  lastSourceAttempt=Date.now();
  sourceLoad=(async()=>{
    try{
      const next=parseMapSource(await request(MAP_SOURCE_URL,true));source=next;
      if(ROOT)try{await FS.makeDirectoryAsync(ROOT,{intermediates:true});await FS.writeAsStringAsync(`${ROOT}source.json`,JSON.stringify(next));}catch{}
      return next;
    }catch{return source;}
    finally{sourceLoad=undefined;}
  })();
  return sourceLoad;
}
async function currentSource():Promise<MapSource|null>{
  const cached=await readSource();
  if(cached){
    // A cached map opens immediately, including offline. Source versions are
    // refreshed in the background, so tiles from different releases never mix.
    if(cached.expiresAt<Date.now() && Date.now()-lastSourceAttempt>30000)void refreshSource();
    return cached;
  }
  return refreshSource();
}
/** Visible-only, coalesced vector requests; cache files are disposable. */
export async function cachedMapTile(tile:MapTile,stillVisible:()=>boolean):Promise<VectorTile|null>{
  if(!stillVisible())return null;
  const mapSource=await currentSource();if(!mapSource || !stillVisible())return null;
  const key=`${mapSource.version}-${tile.key}`,path=ROOT?`${ROOT}${key}.pbf`:null;
  const current=inflight.get(key);
  if(current){current.viewers.add(stillVisible);try{return await current.promise;}finally{current.viewers.delete(stillVisible);}}
  const viewers=new Set([stillVisible]),visible=()=>[...viewers].some(check=>check());
  const task=(async()=>{
    let release:(()=>void)|undefined;
    try{
      if(path)try{
        const info=await FS.getInfoAsync(path);
        if(info.exists && !info.isDirectory && info.size>0 && info.size<=4*1024*1024)
          return decodeMapTile(toByteArray(await FS.readAsStringAsync(path,{encoding:FS.EncodingType.Base64})));
      }catch{await FS.deleteAsync(path,{idempotent:true}).catch(()=>{});}
      if(!visible())return null;
      release=await slot();if(!visible())return null;
      const bytes=await request(mapTileUrl(tile,mapSource),false) as Uint8Array;
      const decoded=decodeMapTile(bytes);
      if(path)try{
        await FS.makeDirectoryAsync(ROOT!,{intermediates:true});
        await FS.writeAsStringAsync(`${path}.part`,fromByteArray(bytes),{encoding:FS.EncodingType.Base64});
        await FS.moveAsync({from:`${path}.part`,to:path});
      }catch{await FS.deleteAsync(`${path}.part`,{idempotent:true}).catch(()=>{});}
      return decoded;
    }catch{return null;}finally{release?.();}
  })();
  inflight.set(key,{promise:task,viewers});
  try{return await task;}finally{viewers.delete(stillVisible);if(inflight.get(key)?.promise===task)inflight.delete(key);}
}
