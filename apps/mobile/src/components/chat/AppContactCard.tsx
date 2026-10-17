import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ContactAttachment } from '../../media/attachmentModel';
import { colors } from '../../theme';
import { useUserProfiles } from '../../lib/userProfiles';
import { displayNameFor } from '../../lib/displayNames.pure';
import { avatarColor, initials } from '../../lib/avatar';
import { attachmentCardStyles, attachmentCardWidth } from './attachmentCardStyles';

export function AppContactCard({ contact, myUid, onOpen, onLongPress, footer }: {
  contact: ContactAttachment & { uid: string }; myUid?: string;
  onOpen?: (uid: string) => Promise<void>; onLongPress?: () => void; footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  // Reuse the shared batched profile cache so old cards show the current avatar.
  const profile = useUserProfiles([contact.uid])[contact.uid];
  const name = displayNameFor(profile, {uid:contact.uid,snapshot:contact.name,fallback:t('names.unknownUser')});
  const photo = profile?.photoURL && /^https:\/\//i.test(profile.photoURL) ? profile.photoURL : null;
  const [failedPhoto, setFailedPhoto] = useState<string|null>(null);
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
  const label=t(self ? 'attachments.yourContact' : 'attachments.messageContact');
  return <View style={[attachmentCardStyles.card,{width:attachmentCardWidth(width)}]}>
    <Pressable onPress={() => {void open();}} onLongPress={onLongPress} delayLongPress={300}
      accessibilityRole="button" accessibilityLabel={`${name}, ${label}`}
      accessibilityState={{disabled:self || busy || !onOpen}} style={s.header}>
      <View style={s.row}>
        {photo && failedPhoto!==photo ? <Image source={{uri:photo}} style={s.avatar} onError={()=>setFailedPhoto(photo)}/> :
          <View style={[s.avatar,{backgroundColor:avatarColor(contact.uid)}]}><Text style={s.initials}>{initials(name)}</Text></View>}
        <Text style={s.name} numberOfLines={2}>{name}</Text>
      </View>
      <View style={attachmentCardStyles.receipt}>{footer}</View>
    </Pressable>
    <Pressable style={s.actionRow} onPress={() => {void open();}} onLongPress={onLongPress} delayLongPress={300}
      disabled={self || busy || !onOpen} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{disabled:self || busy || !onOpen,busy}}>
      {busy ? <ActivityIndicator color="#00896D"/> : <Text style={s.action}>{label}</Text>}
    </Pressable>
  </View>;
}
const s = StyleSheet.create({
  header:{paddingTop:10},row:{flexDirection:'row',alignItems:'center',gap:15,paddingHorizontal:15,minHeight:48},
  avatar:{width:48,height:48,borderRadius:24,alignItems:'center',justifyContent:'center'},initials:{fontSize:18,fontWeight:'600',color:'#fff'},
  name:{flex:1,fontSize:14,fontWeight:'600',lineHeight:20,color:colors.ink,textAlign:'auto'},
  actionRow:{minHeight:44,alignItems:'center',justifyContent:'center',paddingHorizontal:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'rgba(17,27,33,0.14)'},
  action:{fontSize:14,fontWeight:'600',color:'#00896D',textAlign:'center'},
});
