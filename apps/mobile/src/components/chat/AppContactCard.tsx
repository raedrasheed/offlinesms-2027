import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useDisplayName } from '../../lib/userProfiles';
import type { ContactAttachment } from '../../media/attachmentModel';
import { colors } from '../../theme';

export function AppContactCard({ contact, myUid, onOpen, onLongPress }: {
  contact: ContactAttachment & { uid: string }; myUid?: string;
  onOpen?: (uid: string) => Promise<void>; onLongPress?: () => void;
}) {
  const { t } = useTranslation();
  const name = useDisplayName(contact.uid, { snapshot: contact.name });
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const self = contact.uid === myUid;
  async function open() {
    if (opening.current || self || !onOpen) return;
    opening.current = true; setBusy(true);
    try { await onOpen(contact.uid); }
    catch (error: any) {
      Alert.alert(t('attachments.contactOpenError'), t(error?.code === 'functions/not-found' ? 'attachments.contactUnavailable' : 'attachments.contactOpenRetry'));
    } finally { opening.current = false; setBusy(false); }
  }
  return <Pressable style={s.card} onPress={() => {void open();}} onLongPress={onLongPress}
    accessibilityRole="button" accessibilityLabel={`${name}, ${t(self ? 'attachments.yourContact' : 'attachments.messageContact')}`}
    accessibilityState={{disabled: self || busy || !onOpen}}>
    <View style={s.row}>
      <View style={s.icon}><Ionicons name="person" size={27} color={colors.primary}/></View>
      <View style={s.details}><Text style={s.name}>{name}</Text><Text style={s.meta}>OfflineSMS</Text></View>
    </View>
    {busy ? <ActivityIndicator color={colors.primary}/> : <Text style={s.action}>{t(self ? 'attachments.yourContact' : 'attachments.messageContact')}</Text>}
  </Pressable>;
}
const s = StyleSheet.create({
  card:{minWidth:210,maxWidth:270,gap:12,padding:5},row:{flexDirection:'row',alignItems:'center',gap:12},
  icon:{width:49,height:49,backgroundColor:colors.primaryLight,borderRadius:13,alignItems:'center',justifyContent:'center'},
  details:{flex:1},name:{fontSize:15,fontWeight:'700',color:colors.ink,textAlign:'auto'},meta:{fontSize:12,color:colors.ink500,marginTop:4},
  action:{fontSize:14,fontWeight:'700',color:colors.primary,paddingVertical:7,textAlign:'center'},
});
