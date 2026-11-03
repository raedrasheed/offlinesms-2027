import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { getClipsFeed, type ClipFeedMode, type ClipItem } from '../lib/clips';
import { appendUniqueClips, loadClipWindow } from '../lib/clipFeedModel';

export function useClipsFeed(input: {mode: ClipFeedMode; ownerUid?: string; query?: string; enabled?: boolean}) {
  const uid = auth.currentUser?.uid;
  const key = JSON.stringify([uid, input.mode, input.ownerUid, input.query]);
  const [state, setState] = useState<{key: string; items: ClipItem[]; cursor: string | null; error: boolean; ready: boolean}>({key:'',items:[],cursor:null,error:false,ready:false});
  const [busy, setBusy] = useState(false);
  const current = useRef({key, generation: 0, flight: false});
  if (current.current.key !== key) current.current = {key, generation:current.current.generation+1,flight:false};
  const load = useCallback(async (reset: boolean) => {
    if (input.enabled === false || !uid) return;
    if (current.current.flight && !reset) return;
    if (reset) current.current.generation++;
    const generation = current.current.generation;
    const valid = () => current.current.key === key && current.current.generation === generation && auth.currentUser?.uid === uid;
    current.current.flight = true; setBusy(true);
    if (reset) setState(previous => ({...previous,key,items:previous.key===key?previous.items:[],error:false}));
    try {
      const page = await loadClipWindow(getClipsFeed, {
        mode:input.mode, ...(input.ownerUid ? {ownerUid:input.ownerUid} : {}), ...(input.query ? {query:input.query} : {}),
        ...(!reset && state.key===key && state.cursor ? {cursor:state.cursor} : {}), limit:10,
      }, valid);
      if (!valid()) return;
      setState(previous => ({key,items:reset || previous.key!==key ? page.items : appendUniqueClips(previous.items,page.items),cursor:page.nextCursor,error:false,ready:true}));
    } catch { if(valid()) setState(previous => ({...previous,key,error:true,ready:true})); }
    finally { if(valid()) {current.current.flight=false;setBusy(false);} }
  },[uid,key,input.mode,input.ownerUid,input.query,input.enabled,state.key,state.cursor]);
  const loader = useRef(load); loader.current=load;
  useEffect(() => { if(input.enabled !== false) void loader.current(true); else {setBusy(false);setState({key,items:[],cursor:null,error:false,ready:false});} return () => {current.current.generation++; current.current.flight=false;}; },[key,input.enabled]);
  const refresh = useCallback(() => loader.current(true), []);
  const loadMore = useCallback(() => {if(state.key===key && state.cursor) return loader.current(false);},[state.cursor,state.key,key]);
  const patch = useCallback((id:string, changes:Partial<ClipItem>) => setState(previous => ({...previous,items:previous.items.map(item => item.id===id ? {...item,...changes} : item)})),[]);
  const remove = useCallback((id:string) => setState(previous => ({...previous,items:previous.items.filter(item=>item.id!==id)})),[]);
  const visible = state.key===key ? state : {items:[],cursor:null,error:false,ready:false};
  return {items:visible.items,busy,error:visible.error,ready:visible.ready,hasMore:!!visible.cursor,refresh,loadMore,patch,remove};
}
