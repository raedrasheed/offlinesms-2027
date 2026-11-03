import { isClipTermsCancellation } from '../../lib/clipTerms';
import ClipProfileHeader, { profileStyles as s } from '../../components/clips/ClipProfileHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions, type ViewToken } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { getClipProfile, followClipCreator, type ClipProfile as Profile, type ClipItem } from '../../lib/clips';
import { useClipsCopy, clipCount } from '../../lib/clipsCopy';
import { useClipsFeed } from '../../hooks/useClipsFeed';
import { useClipThumbnails } from '../../hooks/useClipThumbnails';
import { useClipVisibility } from '../../hooks/useClipVisibility';

export default function ClipProfile({route,navigation}:any){
  const {c}=useClipsCopy();const insets=useSafeAreaInsets();const visible=useClipVisibility();const {width}=useWindowDimensions();
  const uid=(route.params?.uid as string|undefined)??auth.currentUser?.uid??'';
  const [profile,setProfile]=useState<Profile|null>(null);const [error,setError]=useState(false);const [busy,setBusy]=useState(false);
  const [tab,setTab]=useState<'profile'|'saved'>('profile');const [visibleIds,setVisibleIds]=useState<string[]>([]);
  const [profileAttempt,setProfileAttempt]=useState(0);
  const own=uid===auth.currentUser?.uid;const currentUid=useRef(uid);currentUid.current=uid;
  useEffect(()=>{setProfile(null);setTab('profile');setVisibleIds([]);setBusy(false);},[uid]);
  useFocusEffect(useCallback(()=>{let live=true;setError(false);setProfile(null);setVisibleIds([]);void getClipProfile(uid).then(result=>{if(live)setProfile(result);}).catch(()=>{if(live){setProfile(null);setError(true);}});return()=>{live=false;};},[uid,profileAttempt]));
  const feed=useClipsFeed({mode:tab,ownerUid:uid,enabled:visible&&!!profile&&!profile.blocked});
  const thumbs=useClipThumbnails(visibleIds.length?visibleIds:feed.items.slice(0,12).map(item=>item.id),visible&&!!profile);
  const onViewable=useRef(({viewableItems}:{viewableItems:ViewToken[]})=>setVisibleIds(viewableItems.filter(v=>v.isViewable).map(v=>(v.item as ClipItem).id).slice(0,24))).current;
  const tileWidth=(width-32-8)/3;
  async function follow(){if(!profile||busy)return;setBusy(true);try{const following=profile.followStatus==='none';const result=await followClipCreator(uid,following);if(currentUid.current===uid){setProfile(previous=>previous?.uid===uid?{...previous,followStatus:result.status,followerCount:Math.max(0,previous.followerCount+(result.status==='accepted'?1:previous.followStatus==='accepted'?-1:0))}:previous);void feed.refresh();}}catch(error){if(isClipTermsCancellation(error))return;Alert.alert(c('Clips','مقاطع'),c('Could not update the follow request.','تعذر تحديث طلب المتابعة.'));}finally{if(currentUid.current===uid)setBusy(false);}}
  function refresh(){setProfileAttempt(n=>n+1);void feed.refresh();}
  const statusLabel=(item:ClipItem)=>item.status==='pending_review'?c('In review','قيد المراجعة'):item.status==='processing'||item.status==='uploading'?c('Processing','جارٍ التجهيز'):item.status==='rejected'?c('Not approved','لم تتم الموافقة'):item.status==='failed'?c('Processing failed','تعذر التجهيز'):'';
  return <View style={[s.root,{paddingTop:insets.top}]}>
    <View style={s.nav}><Pressable style={s.icon} onPress={()=>navigation.goBack()} accessibilityLabel={c('Back','رجوع')}><Ionicons name="chevron-back" size={26} color="#102A3B"/></Pressable><Text style={s.navTitle} numberOfLines={1}>{profile?.displayName||c('Creator profile','ملف الناشر')}</Text>{own?<Pressable style={s.icon} onPress={()=>navigation.navigate('ClipPreferences')} accessibilityLabel={c('Clip settings','إعدادات المقاطع')}><Ionicons name="settings-outline" size={23} color="#102A3B"/></Pressable>:<View style={s.icon}/>}</View>
    {!profile?<View style={s.center}>{error?<><Ionicons name="cloud-offline-outline" size={45} color="#6C8798"/><Text style={s.emptyTitle}>{c('Profile is unavailable','الملف غير متاح')}</Text><Pressable onPress={refresh} style={s.primary}><Text style={s.primaryText}>{c('Try again','إعادة المحاولة')}</Text></Pressable></>:<ActivityIndicator color="#1F7BA8"/>}</View>:<FlatList key={`${uid}:${tab}`} data={feed.items} numColumns={3} keyExtractor={item=>item.id}
      contentContainerStyle={{paddingHorizontal:16,paddingBottom:insets.bottom+25}} columnWrapperStyle={{gap:4}}
      onViewableItemsChanged={onViewable} viewabilityConfig={{itemVisiblePercentThreshold:1}} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
      onEndReached={()=>{void feed.loadMore();}} onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={feed.busy&&feed.items.length>0} onRefresh={refresh} tintColor="#1F7BA8"/>}
      ListHeaderComponent={<ClipProfileHeader profile={profile} own={own} busy={busy} tab={tab}
        onCreate={()=>navigation.navigate('ClipComposer')} onDrafts={()=>navigation.navigate('ClipDrafts')}
        onFollow={()=>{void follow();}} onRequests={()=>navigation.navigate('ClipFollowRequests')}
        onTab={value=>{setTab(value);setVisibleIds([]);}}/>}
      renderItem={({item})=><Pressable onPress={()=>navigation.navigate('ClipViewer',{clipId:item.id})} style={[s.tile,{width:tileWidth,height:tileWidth*1.45}]} accessibilityLabel={`${c('Open clip','فتح المقطع')} ${item.caption}`}>
        {thumbs[item.id]?<Image source={{uri:thumbs[item.id]}} style={StyleSheet.absoluteFill} resizeMode="cover"/>:<View style={s.tilePlaceholder}><Ionicons name="play-outline" color="#87A6B9" size={28}/></View>}
        {statusLabel(item)?<View style={s.badge}><Text style={s.badgeText}>{statusLabel(item)}</Text></View>:null}
        <View style={s.tileFooter}><Ionicons name="play-outline" size={14} color="#fff"/><Text style={s.views}>{clipCount(item.viewCount)}</Text>{item.audience!=='public'?<Ionicons name="lock-closed-outline" size={12} color="#fff"/>:null}</View>
      </Pressable>}
      ListEmptyComponent={<View style={s.empty}>{feed.busy?<ActivityIndicator color="#1F7BA8"/>:<><Ionicons name={profile.blocked?'ban-outline':profile.privateAccount&&!own&&profile.followStatus!=='accepted'?'lock-closed-outline':'videocam-outline'} size={40} color="#93A9B8"/><Text style={s.emptyTitle}>{profile.blocked?c('This profile is not available','هذا الملف غير متاح'):profile.privateAccount&&!own&&profile.followStatus!=='accepted'?c('Follow to request access','أرسل طلب متابعة للمشاهدة'):feed.error?c('Could not load clips','تعذر تحميل المقاطع'):tab==='saved'?c('Your saved clips appear here','تظهر مقاطعك المحفوظة هنا'):c('No clips yet','لا توجد مقاطع بعد')}</Text>{feed.hasMore||feed.error?<Pressable style={s.outline} onPress={()=>{void(feed.error?feed.refresh():feed.loadMore());}}><Text style={s.outlineText}>{c('Load more','تحميل المزيد')}</Text></Pressable>:null}</>}</View>}
      ListFooterComponent={feed.items.length>0&&feed.busy?<ActivityIndicator style={{margin:25}} color="#1F7BA8"/>:null}
    />}
  </View>;
}
