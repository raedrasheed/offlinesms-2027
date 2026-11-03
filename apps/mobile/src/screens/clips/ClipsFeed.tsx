import { listSocialActivity } from '../../lib/socialActivity';
import { isClipTermsCancellation } from '../../lib/clipTerms';
import ClipFeedHeader, {feedStyles as s} from '../../components/clips/ClipFeedHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewToken } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetInfo } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { getClipsConfig, followClipCreator, setClipInteraction, type ClipItem } from '../../lib/clips';
import { useClipsCopy } from '../../lib/clipsCopy';
import { clipQuality } from '../../lib/clipFeedModel';
import { useClipsFeed } from '../../hooks/useClipsFeed';
import { useClipPreferences } from '../../hooks/useClipPreferences';
import { useClipVisibility } from '../../hooks/useClipVisibility';
import ClipCard from '../../components/clips/ClipCard';
import ClipCommentsSheet from '../../components/clips/ClipCommentsSheet';
import ClipShareSheet from '../../components/clips/ClipShareSheet';
import ClipActionsSheet from '../../components/clips/ClipActionsSheet';

export default function ClipsFeed({navigation}:any){
  const {c}=useClipsCopy();const insets=useSafeAreaInsets();const dimensions=useWindowDimensions();
  const visible=useClipVisibility();const network=useNetInfo();const {settings,update}=useClipPreferences();
  const [unreadActivity,setUnreadActivity]=useState(false);
  const [enabled,setEnabled]=useState<boolean|null>(null);const [configError,setConfigError]=useState(false);
  const [mode,setMode]=useState<'forYou'|'following'>('forYou');const [searchOpen,setSearchOpen]=useState(false);
  const [search,setSearch]=useState('');const [query,setQuery]=useState('');const [height,setHeight]=useState(dimensions.height);
  const [activeId,setActiveId]=useState<string|null>(null);const [panel,setPanel]=useState<'comments'|'share'|'actions'|null>(null);
  const [selected,setSelected]=useState<ClipItem|null>(null);const [busyId,setBusyId]=useState<string|null>(null);
  const feed=useClipsFeed({mode,query,enabled:enabled===true&&visible});
  const quality=clipQuality(settings.dataSaving,network.type);
  const loadConfig=useCallback(()=>{let live=true;setConfigError(false);void getClipsConfig().then(result=>{if(live)setEnabled(result.config.enabled);}).catch(()=>{if(live){setConfigError(true);setEnabled(null);}});return()=>{live=false;};},[]);
  useFocusEffect(loadConfig);
  useFocusEffect(useCallback(()=>{let live=true;const uid=auth.currentUser?.uid;void listSocialActivity({limit:30}).then(page=>{if(live&&uid===auth.currentUser?.uid)setUnreadActivity(page.items.some(item=>item.unread));}).catch(()=>{});return()=>{live=false;};},[]));
  useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),300);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{if(!feed.items.some(item=>item.id===activeId))setActiveId(feed.items[0]?.id??null);},[feed.items,activeId]);
  useEffect(()=>{if(!visible){setPanel(null);setSelected(null);}},[visible]);
  const onViewable=useRef(({viewableItems}:{viewableItems:ViewToken[]})=>{const item=viewableItems.find(v=>v.isViewable)?.item as ClipItem|undefined;if(item)setActiveId(item.id);}).current;
  const viewConfig=useRef({itemVisiblePercentThreshold:75,minimumViewTime:120}).current;
  function openPanel(type:'comments'|'share'|'actions',clip:ClipItem){setSelected(clip);setPanel(type);}
  async function interact(clip:ClipItem,type:'like'|'save'){
    if(busyId)return;setBusyId(clip.id);
    const active=type==='like'?!clip.likedByMe:!clip.savedByMe;
    try{const result=await setClipInteraction(clip.id,type,active);feed.patch(clip.id,type==='like'?{likedByMe:active,likeCount:result.likeCount}:{savedByMe:active});}
    catch(error){if(isClipTermsCancellation(error))return;Alert.alert(c('Clips','مقاطع'),c('Could not update this clip. Please try again.','تعذر تحديث المقطع. حاول مرة أخرى.'));}
    finally{setBusyId(null);}
  }
  async function follow(clip:ClipItem){
    if(busyId)return;setBusyId(clip.id);try{const result=await followClipCreator(clip.ownerUid,clip.followStatus!=='pending'&&clip.followStatus!=='accepted');for(const item of feed.items)if(item.ownerUid===clip.ownerUid)feed.patch(item.id,{followStatus:result.status});}
    catch(error){if(isClipTermsCancellation(error))return;Alert.alert(c('Clips','مقاطع'),c('Could not update the follow request.','تعذر تحديث طلب المتابعة.'));}finally{setBusyId(null);}
  }
  function removeSelected(){if(selected)feed.remove(selected.id);setPanel(null);}
  return <View style={s.root} onLayout={event=>setHeight(event.nativeEvent.layout.height)}>
    {enabled===true?<FlatList data={feed.items} keyExtractor={item=>item.id} renderItem={({item})=><ClipCard clip={item} height={height} bottomInset={insets.bottom+89}
      active={visible&&!panel&&activeId===item.id} muted={settings.muted} quality={quality} busy={busyId===item.id}
      onMute={()=>{void update({muted:!settings.muted}).catch(()=>{});}} onLike={()=>{void interact(item,'like');}} onSave={()=>{void interact(item,'save');}}
      onFollow={()=>{void follow(item);}} onProfile={()=>navigation.navigate('ClipProfile',{uid:item.ownerUid})}
      onComments={()=>openPanel('comments',item)} onShare={()=>openPanel('share',item)} onMore={()=>openPanel('actions',item)}/>}
      pagingEnabled snapToInterval={height} decelerationRate="fast" showsVerticalScrollIndicator={false}
      getItemLayout={(_,index)=>({length:height,offset:height*index,index})} initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
      onViewableItemsChanged={onViewable} viewabilityConfig={viewConfig} onEndReached={()=>{void feed.loadMore();}} onEndReachedThreshold={0.65}
      refreshControl={<RefreshControl refreshing={feed.busy&&feed.items.length>0} onRefresh={()=>{void feed.refresh();}} tintColor="#fff" progressViewOffset={insets.top+68}/>}
      ListEmptyComponent={<View style={[s.empty,{height}]}><Ionicons name={feed.error?'cloud-offline-outline':mode==='following'?'people-outline':'play-circle-outline'} size={64} color="#7CABC7"/>
        {feed.busy?<ActivityIndicator color="#fff"/>:<><Text style={s.emptyTitle}>{feed.error?c('Could not load clips','تعذر تحميل المقاطع'):query?c('No matching clips in this page','لا توجد مقاطع مطابقة في هذه الصفحة'):mode==='following'?c('Your following feed starts here','مقاطع من تتابعهم تبدأ هنا'):c('A space for your moments','مساحة للحظاتك')}</Text>
        <Text style={s.emptyBody}>{feed.error?c('Check your connection and try again.','تحقق من الاتصال وحاول مجددًا.'):query?c('Try another word or keep browsing.','جرّب كلمة أخرى أو تابع التصفح.'):mode==='following'?c('Follow creators to see their latest clips.','تابع صانعي المحتوى لمشاهدة أحدث مقاطعهم.'):c('Record a moment or upload your first clip.','سجّل لحظة أو ارفع أول مقطع لك.')}</Text>
        <Pressable style={s.primary} onPress={()=>feed.error?void feed.refresh():feed.hasMore?void feed.loadMore():navigation.navigate('ClipComposer')}><Text style={s.primaryText}>{feed.error?c('Try again','إعادة المحاولة'):feed.hasMore?c('Keep browsing','متابعة التصفح'):c('Create a clip','إنشاء مقطع')}</Text></Pressable></>}
      </View>}
      ListFooterComponent={feed.items.length>0&&feed.busy?<View style={s.footer}><ActivityIndicator color="#fff"/></View>:feed.items.length>0&&feed.error?<Pressable style={s.footer} onPress={()=>{void feed.loadMore();}}><Text style={s.primaryText}>{c('Load more · Try again','تحميل المزيد · أعد المحاولة')}</Text></Pressable>:null}
    />:<View style={[s.empty,{height}]}><Ionicons name="play-circle-outline" size={64} color="#7CABC7"/>
      {enabled===null&&!configError?<ActivityIndicator color="#fff"/>:<><Text style={s.emptyTitle}>{configError?c('Could not load clips','تعذر تحميل المقاطع'):c('Clips are not available yet','المقاطع غير متاحة حاليًا')}</Text><Text style={s.emptyBody}>{configError?c('Check your connection and try again.','تحقق من الاتصال وحاول مجددًا.'):c('You can keep using chats and statuses.','يمكنك متابعة استخدام المحادثات والحالات.')}</Text>{configError?<Pressable style={s.primary} onPress={loadConfig}><Text style={s.primaryText}>{c('Try again','إعادة المحاولة')}</Text></Pressable>:null}</>}
    </View>}
    <ClipFeedHeader top={insets.top+8} mode={mode} enabled={enabled} searchOpen={searchOpen} unreadActivity={unreadActivity} onActivity={()=>navigation.navigate('SocialActivity')} onPosts={()=>navigation.navigate('PostsFeed')}
      onSearch={()=>{setSearchOpen(value=>!value);setSearch('');}} onMode={value=>{setMode(value);setActiveId(null);}}
      onCreate={()=>navigation.navigate('ClipComposer')} onProfile={()=>navigation.navigate('ClipProfile',{uid:auth.currentUser?.uid})}/>
    {searchOpen?<View style={[s.search,{top:insets.top+65}]}><Ionicons name="search-outline" size={19} color="#A8BECF"/><TextInput autoFocus value={search} onChangeText={setSearch} placeholder={c('Caption, hashtag or creator','الوصف أو الوسم أو الناشر')} placeholderTextColor="#A8BECF" style={s.input} maxLength={80} returnKeyType="search" onSubmitEditing={()=>setQuery(search.trim())}/></View>:null}
    {selected?<><ClipCommentsSheet visible={panel==='comments'} clip={selected} onClose={()=>setPanel(null)} onCountChange={count=>{feed.patch(selected.id,{commentCount:count});setSelected({...selected,commentCount:count});}}/>
      <ClipShareSheet visible={panel==='share'} clip={selected} onClose={()=>setPanel(null)}/>
      <ClipActionsSheet visible={panel==='actions'} clip={selected} onClose={()=>setPanel(null)} onHidden={removeSelected} onRemoved={removeSelected} onUpdated={clip=>{feed.patch(clip.id,clip);setSelected(clip);}}/></>:null}
  </View>;
}
