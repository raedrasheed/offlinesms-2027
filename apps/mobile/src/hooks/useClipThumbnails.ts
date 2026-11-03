import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { getClipThumbnails } from '../lib/clips';
/** Covers are leased for the visible grid only; no persistent media cache and
 * no download tokens. Any account change drops all previously resolved URLs. */
export function useClipThumbnails(ids:string[],enabled=true) {
  const uid=auth.currentUser?.uid;
  const key=JSON.stringify([uid,[...new Set(ids)].slice(0,24)]);
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;urls:Record<string,string>}>({key:'',urls:{}});
  useEffect(()=>{
    let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
    if(!enabled||!uid||!ids.length){setState({key,urls:{}});return;}
    void getClipThumbnails([...new Set(ids)].slice(0,24)).then(result=>{
      if(!active||auth.currentUser?.uid!==uid)return;
      const valid=result.items.filter(item=>item.expiresAtMs>Date.now());
      setState({key,urls:Object.fromEntries(valid.map(item=>[item.clipId,item.thumbnailUrl]))});
      if(valid.length)timer=setTimeout(()=>setAttempt(n=>n+1),Math.max(1000,Math.min(...valid.map(item=>item.expiresAtMs))-Date.now()-5000));
    }).catch(()=>{if(active)setState({key,urls:{}});});
    return()=>{active=false;if(timer)clearTimeout(timer);};
  },[key,enabled,attempt,uid]);
  return state.key===key&&enabled?state.urls:{};
}
