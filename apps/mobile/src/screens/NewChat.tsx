import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme';
import { getOrCreateDirectConversation } from '../lib/conversations';
import { AppContactPicker } from '../components/chat/AppContactPicker';

export default function NewChat({navigation}:any) {
  const {t}=useTranslation();
  const insets=useSafeAreaInsets();
  const [opening,setOpening]=useState(false);
  const inFlight=useRef(false);
  async function pick(uid:string) {
    if(inFlight.current)return;
    inFlight.current=true;setOpening(true);
    try {
      const id=await getOrCreateDirectConversation(uid);
      navigation.replace('Conversation',{id});
    } catch {Alert.alert(t('attachments.contactOpenError'),t('attachments.contactOpenRetry'));}
    finally{inFlight.current=false;setOpening(false);}
  }
  return <KeyboardAvoidingView style={[s.root,{paddingTop:insets.top,paddingBottom:insets.bottom}]} behavior={Platform.OS==='ios'?'padding':undefined}>
    <View style={s.header}>
      <Pressable onPress={()=>navigation.goBack()} accessibilityRole="button" accessibilityLabel={t('names.close')} hitSlop={12}><Ionicons name="close" size={26} color={colors.ink}/></Pressable>
      <Text style={s.title}>{t('attachments.newContact')}</Text>
    </View>
    <AppContactPicker purpose="chat" disabled={opening} onPick={contact=>{void pick(contact.uid);}}/>
  </KeyboardAvoidingView>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#fff'},header:{padding:16,flexDirection:'row',alignItems:'center',gap:14},title:{fontSize:18,fontWeight:'700',color:colors.ink}});
