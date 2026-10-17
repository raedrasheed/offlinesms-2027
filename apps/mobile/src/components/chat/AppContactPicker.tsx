import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme';
import { avatarColor, initials } from '../../lib/avatar';
import { loadAppContacts, mergeAppContacts, contactSearchErrorKey, type AppContact, type ContactPage } from '../../lib/appContacts';

/** Shared by contact attachments, New chat and New contact. */
export function AppContactPicker({onPick,purpose='share',disabled=false,listHeader}: {
  onPick:(contact:AppContact)=>void;purpose?:'share'|'chat';disabled?:boolean;listHeader?:ReactNode;
}) {
  const {t}=useTranslation();
  const [term,setTerm]=useState('');
  const [rows,setRows]=useState<AppContact[]>([]);
  const [page,setPage]=useState<ContactPage>();
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  const generation=useRef(0);
  const loading=useRef(false);

  async function fetchPages(version:number,search:string,after?:ContactPage) {
    loading.current=true;setBusy(true);setError(null);
    let position=after;
    try {
      do {
        const result=await loadAppContacts(search,position);
        if(version!==generation.current)return;
        if(result.page.hasMore && position && JSON.stringify(result.page.cursor)===JSON.stringify(position.cursor)) throw new Error('cursor-not-advancing');
        setRows(old=>mergeAppContacts(old,result.contacts));setPage(result.page);
        position=result.page;
        // Sparse batches may contain only groups/inactive profiles or index candidates.
        // Keep looking instead of incorrectly showing "No matches" after an empty batch.
        if(result.contacts.length || !result.page.hasMore)break;
      } while(version===generation.current);
    } catch(e) {
      if(version===generation.current)setError(contactSearchErrorKey(e));
    } finally {
      if(version===generation.current){setBusy(false);loading.current=false;}
    }
  }
  useEffect(()=>{
    const version=++generation.current;
    setRows([]);setPage(undefined);setError(null);setBusy(true);loading.current=true;
    const timer=setTimeout(()=>{void fetchPages(version,term);},200);
    return()=>{clearTimeout(timer);generation.current++;};
  },[term,retry]);
  function more(){if(!loading.current && page?.hasMore)void fetchPages(generation.current,term,page);}
  const searching=!!term.trim().replace(/^@/,'').trim();

  return <View style={s.root}>
    <Text style={s.hint}>{t(purpose==='share'?'attachments.chooseAppContact':'attachments.chooseChatContact')}</Text>
    <TextInput value={term} onChangeText={setTerm} maxLength={80} style={s.search} editable={!disabled}
      placeholder={t('attachments.searchAppContacts')} accessibilityLabel={t('attachments.searchAppContacts')}
      placeholderTextColor={colors.ink500} autoCapitalize="none" autoCorrect={false}/>
    {disabled?<ActivityIndicator color={colors.primary}/>:null}
    <FlatList data={rows} keyExtractor={item=>item.uid} keyboardShouldPersistTaps="handled"
      onEndReached={more} onEndReachedThreshold={0.4}
      ListHeaderComponent={<View>{!searching?listHeader:null}<Text style={s.section}>{t(searching?'attachments.contactSearchResults':'attachments.myAppContacts')}</Text></View>}
      renderItem={({item})=><Pressable style={s.row} disabled={disabled} onPress={()=>onPick(item)} accessibilityRole="button" accessibilityLabel={item.name}>
        <View style={[s.avatar,{backgroundColor:avatarColor(item.uid)}]}><Text style={s.initials}>{initials(item.name)}</Text></View>
        <View style={s.details}><Text style={s.name}>{item.name}</Text><Text style={s.hint}>{item.username?`@${item.username}`:'OfflineSMS'}</Text></View>
      </Pressable>}
      ListEmptyComponent={!busy && !error?<Text style={s.hint}>{t(searching?'attachments.noAppContacts':'attachments.noAccountContacts')}</Text>:null}
      ListFooterComponent={<View style={s.footer}>
        {busy?<ActivityIndicator color={colors.primary}/>:null}
        {error?<><Text style={s.hint}>{t(error)}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')} onPress={()=>{if(page?.hasMore)more();else setRetry(n=>n+1);}}><Text style={s.action}>{t('common.retry')}</Text></Pressable></>:
          !busy && page?.hasMore?<Pressable accessibilityRole="button" onPress={more}><Text style={s.action}>{t('attachments.moreContacts')}</Text></Pressable>:null}
      </View>}/>
  </View>;
}
const s=StyleSheet.create({
  root:{flex:1,padding:20,gap:12},hint:{fontSize:14,color:colors.ink500,textAlign:'auto'},section:{fontSize:14,fontWeight:'700',color:colors.ink},
  search:{borderWidth:1,borderColor:colors.ink200,borderRadius:12,padding:13,color:colors.ink,fontSize:16,textAlign:'auto'},
  row:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:13},
  avatar:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center'},initials:{color:'#fff',fontWeight:'700'},
  details:{flex:1,gap:4},name:{fontSize:16,color:colors.ink,fontWeight:'700',textAlign:'auto'},
  footer:{paddingVertical:18,gap:12,alignItems:'center'},action:{padding:10,color:colors.primary,fontWeight:'700'},
});
