import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getOrCreateDirectConversation } from '../lib/conversations';
import { colors, radius } from '../theme';
import { AppContactPicker } from '../components/chat/AppContactPicker';

export default function NewChatMenu({navigation}:any) {
  const {t}=useTranslation();
  const insets=useSafeAreaInsets();
  const [opening,setOpening]=useState(false);
  const inFlight=useRef(false);
  async function openDirect(uid:string) {
    if(inFlight.current)return;
    inFlight.current=true;setOpening(true);
    try {
      const id=await getOrCreateDirectConversation(uid);
      navigation.replace('Conversation',{id});
    } catch {Alert.alert(t('attachments.contactOpenError'),t('attachments.contactOpenRetry'));}
    finally{inFlight.current=false;setOpening(false);}
  }
  const menu=[
    {key:'group',icon:'people' as const,label:t('attachments.newGroup'),onPress:()=>navigation.navigate('NewGroup')},
    {key:'contact',icon:'person-add' as const,label:t('attachments.newContact'),onPress:()=>navigation.navigate('NewChat')},
    {key:'community',icon:'globe-outline' as const,label:t('attachments.newCommunity'),onPress:()=>Alert.alert(t('attachments.newCommunity'),t('attachments.comingSoon'))},
  ];
  return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={[s.root,{paddingBottom:insets.bottom}]}>
    <View style={[s.header,{paddingTop:insets.top+6}]}>
      <Pressable onPress={()=>navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('names.close')}><Ionicons name="chevron-back" size={24} color={colors.primary}/></Pressable>
      <Text style={s.title}>{t('attachments.newChat')}</Text>
    </View>
    <AppContactPicker purpose="chat" disabled={opening} onPick={contact=>{void openDirect(contact.uid);}}
      listHeader={<View>{menu.map((m,i)=><Pressable key={m.key} disabled={opening} style={[s.menuRow,i===0&&s.menuActive]} onPress={m.onPress} accessibilityRole="button">
        <View style={s.menuIcon}><Ionicons name={m.icon} size={20} color={colors.primary}/></View><Text style={s.menuLabel}>{m.label}</Text>
      </Pressable>)}</View>}/>
  </KeyboardAvoidingView>;
}
const s=StyleSheet.create({
  root:{flex:1,backgroundColor:colors.surface},header:{paddingBottom:12,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:12},
  title:{fontSize:18,fontWeight:'800',color:colors.ink},menuRow:{flexDirection:'row',alignItems:'center',gap:16,paddingVertical:12,paddingHorizontal:8},
  menuActive:{backgroundColor:colors.primaryLight,borderRadius:radius.md},menuIcon:{width:44,height:44,borderRadius:22,backgroundColor:colors.primaryLight,alignItems:'center',justifyContent:'center'},
  menuLabel:{fontSize:16,fontWeight:'700',color:colors.ink},
});
