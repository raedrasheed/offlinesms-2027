import { isClipTermsCancellation } from '../../lib/clipTerms';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetInfo } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { getClip, setClipInteraction, followClipCreator, type ClipItem } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';
import { clipQuality } from '../../lib/clipFeedModel';
import { useClipPreferences } from '../../hooks/useClipPreferences';
import { useClipVisibility } from '../../hooks/useClipVisibility';
import ClipCard from '../../components/clips/ClipCard';
import ClipCommentsSheet from '../../components/clips/ClipCommentsSheet';
import ClipShareSheet from '../../components/clips/ClipShareSheet';
import ClipActionsSheet from '../../components/clips/ClipActionsSheet';
export default function ClipViewer({route,navigation}:any){
  const {c}=useClipsCopy();const insets=useSafeAreaInsets();const {height}=useWindowDimensions();const visible=useClipVisibility();
  const {settings,update}=useClipPreferences();const network=useNetInfo();const id=route.params?.clipId as string|undefined;
  const uid=auth.currentUser?.uid;const identity=`${uid}:${id}`;
  const current=useRef({identity,generation:0});
  if(current.current.identity!==identity)current.current={identity,generation:current.current.generation+1};
  const [clipValue,setClip]=useState<ClipItem|null>(null);const clip=clipValue?.id===id?clipValue:null;const [error,setError]=useState(false);const [attempt,setAttempt]=useState(0);
  const autoShareHandled=useRef<string|null>(null);
  const [panel,setPanel]=useState<'comments'|'share'|'actions'|null>(null);const [busy,setBusy]=useState(false);
  useFocusEffect(useCallback(()=>{let live=true;current.current.generation++;setClip(null);setError(false);setPanel(null);setBusy(false);if(!id){setError(true);return;}
    void getClip(id).then(value=>{if(live&&auth.currentUser?.uid===uid){setClip(value);if(route.params?.share===true&&autoShareHandled.current!==id&&value.status==='published'){autoShareHandled.current=id;setPanel('share');}}}).catch(()=>{if(live)setError(true);});return()=>{live=false;current.current.generation++;};},[identity,attempt,route.params?.share]));
  const generation=current.current.generation;
  const stillCurrent=()=>current.current.identity===identity&&current.current.generation===generation&&auth.currentUser?.uid===uid;
  function patch(targetId:string,changes:Partial<ClipItem>){if(stillCurrent())setClip(previous=>previous?.id===targetId?{...previous,...changes}:previous);}
  async function interact(type:'like'|'save'){
    if(!clip||busy)return;setBusy(true);const targetId=clip.id;
    try{const active=type==='like'?!clip.likedByMe:!clip.savedByMe;const result=await setClipInteraction(targetId,type,active);patch(targetId,type==='like'?{likedByMe:active,likeCount:result.likeCount}:{savedByMe:active});}
    catch(error){if(stillCurrent()&&!isClipTermsCancellation(error))Alert.alert(c('Clips','مقاطع'),c('Could not update this clip.','تعذر تحديث المقطع.'));}
    finally{if(stillCurrent())setBusy(false);}
  }
  async function follow(){
    if(!clip||busy)return;setBusy(true);const targetId=clip.id;
    try{const value=await followClipCreator(clip.ownerUid,clip.followStatus!=='pending'&&clip.followStatus!=='accepted');patch(targetId,{followStatus:value.status});}
    catch(error){if(stillCurrent()&&!isClipTermsCancellation(error))Alert.alert(c('Clips','مقاطع'),c('Could not update the follow request.','تعذر تحديث طلب المتابعة.'));}
    finally{if(stillCurrent())setBusy(false);}
  }
  const playable=clip&&(clip.status==='published'||clip.status==='pending_review');
  return <View style={s.root}>
    {clip&&playable?<ClipCard clip={clip} active={visible&&!panel} muted={settings.muted} quality={clipQuality(settings.dataSaving,network.type)} height={height} bottomInset={insets.bottom+10} busy={busy}
      onMute={()=>{void update({muted:!settings.muted}).catch(()=>{});}} onLike={()=>{void interact('like');}} onSave={()=>{void interact('save');}} onFollow={()=>{void follow();}}
      onProfile={()=>navigation.navigate('ClipProfile',{uid:clip.ownerUid})} onComments={()=>setPanel('comments')} onShare={()=>setPanel('share')} onMore={()=>setPanel('actions')}/>:<View style={s.center}>
      {!clip&&!error?<ActivityIndicator color="#fff"/>:<><Ionicons name={error?'lock-closed-outline':'videocam-outline'} size={55} color="#9CBBD0"/><Text style={s.title}>{error?c('This clip is unavailable','هذا المقطع غير متاح'):clip?.status==='processing'||clip?.status==='uploading'?c('Your clip is being prepared','جارٍ تجهيز مقطعك'):clip?.status==='failed'?c('Could not prepare this clip','تعذر تجهيز هذا المقطع'):clip?.status==='rejected'?c('This clip was not approved','لم تتم الموافقة على هذا المقطع'):c('This clip is no longer available','هذا المقطع لم يعد متاحًا')}</Text><Text style={s.body}>{error?c('It may have been deleted, or you may not have permission to view it.','ربما حُذف المقطع أو لم تعد لديك صلاحية مشاهدته.'):c('Refresh to check its latest status.','حدّث للتحقق من آخر حالة.')}</Text><Pressable style={s.button} onPress={()=>setAttempt(n=>n+1)}><Text style={s.buttonText}>{c('Refresh','تحديث')}</Text></Pressable>{clip?<Pressable style={s.button} onPress={()=>setPanel('actions')}><Text style={s.buttonText}>{c('Manage clip','إدارة المقطع')}</Text></Pressable>:null}</>}
    </View>}
    <View style={[s.top,{top:insets.top+8}]}><Pressable onPress={()=>navigation.goBack()} style={s.back} accessibilityLabel={c('Back','رجوع')}><Ionicons name="chevron-back" color="#fff" size={27}/></Pressable>{clip?.status==='pending_review'?<Text style={s.review}>{c('Only you · awaiting review','أنت فقط · بانتظار المراجعة')}</Text>:null}</View>
    {clip?<><ClipCommentsSheet visible={panel==='comments'} clip={clip} onClose={()=>setPanel(null)} onCountChange={count=>patch(clip.id,{commentCount:count})}/><ClipShareSheet visible={panel==='share'} clip={clip} onClose={()=>setPanel(null)}/><ClipActionsSheet visible={panel==='actions'} clip={clip} onClose={()=>setPanel(null)} onUpdated={value=>patch(value.id,value)} onRemoved={()=>{if(stillCurrent())navigation.goBack();}} onHidden={()=>{if(stillCurrent())navigation.goBack();}}/></>:null}
  </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#0C141C'},top:{position:'absolute',left:14,right:14,flexDirection:'row',alignItems:'center',gap:12},back:{height:44,width:44,borderRadius:24,backgroundColor:'#0004',alignItems:'center',justifyContent:'center'},review:{color:'#fff',fontWeight:'700',backgroundColor:'#28485DE0',padding:10,borderRadius:18},center:{flex:1,alignItems:'center',justifyContent:'center',padding:32,gap:18},title:{color:'#fff',fontSize:22,fontWeight:'800',textAlign:'center'},body:{color:'#BACBD7',fontSize:15,lineHeight:23,textAlign:'center'},button:{backgroundColor:'#1F7BA8',borderRadius:22,paddingHorizontal:24,paddingVertical:12},buttonText:{color:'#fff',fontWeight:'700'}});
