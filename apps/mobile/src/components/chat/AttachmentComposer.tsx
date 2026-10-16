import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Image, Alert, ActivityIndicator, Linking } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { attachmentLimit, parseContact, parseLocation, type ContactAttachment, type LocationAttachment } from '../../media/attachmentModel';

export type AttachmentDraft =
  | { kind: 'location'; location?: LocationAttachment }
  | { kind: 'contact'; contact?: ContactAttachment }
  | { kind: 'binary'; mediaType: 'file' | 'audio' | 'video' | 'image'; uri: string; fileName: string; mimeType: string; sizeBytes: number; width?: number; height?: number; durationMs?: number; caption?: string };

/** Selection is a draft. Nothing leaves the device before the explicit Send tap. */
export function AttachmentComposer({ draft, onClose, onSend }: {
  draft: AttachmentDraft; onClose: () => void; onSend: (draft: AttachmentDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [caption, setCaption] = useState('');
  const [name, setName] = useState(draft.kind === 'contact' ? draft.contact?.name ?? '' : '');
  const [phones, setPhones] = useState(draft.kind === 'contact' ? draft.contact?.phones.join('\n') ?? '' : '');
  const [emails, setEmails] = useState(draft.kind === 'contact' ? draft.contact?.emails.join('\n') ?? '' : '');
  const [latitude, setLatitude] = useState(draft.kind === 'location' && draft.location ? String(draft.location.latitude) : '');
  const [longitude, setLongitude] = useState(draft.kind === 'location' && draft.location ? String(draft.location.longitude) : '');
  const [position, setPosition] = useState<LocationAttachment | undefined>(draft.kind === 'location' ? draft.location : undefined);
  const [label, setLabel] = useState('');
  async function locate() {
    if (locating) return;
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('attachments.permissionTitle'), t('attachments.locationPermission'), [
          {text:t('common.cancel'),style:'cancel'}, {text:t('attachments.settings'),onPress:() => {void Linking.openSettings();}},
        ]); return;
      }
      // A single foreground fix; no background tracking or watch subscription.
      const location = await Promise.race([
        Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('location-timeout')), 15000)),
      ]);
      const p = {latitude:location.coords.latitude,longitude:location.coords.longitude,
        ...(location.coords.accuracy != null ? {accuracy:location.coords.accuracy} : {}),capturedAt:location.timestamp};
      setPosition(p);setLatitude(String(p.latitude));setLongitude(String(p.longitude));
    } catch { Alert.alert(t('attachments.locationUnavailable'),t('attachments.manualCoordinates')); }
    finally { setLocating(false); }
  }
  async function send() {
    if (busy || locating) return;
    let value = draft;
    if (draft.kind === 'contact') {
      const contact = parseContact({name,phones:phones.split('\n').map(s => s.trim()).filter(Boolean),emails:emails.split('\n').map(s => s.trim()).filter(Boolean)});
      if (!contact) {Alert.alert(t('attachments.invalidContact'));return;}
      value={kind:'contact',contact};
    } else if (draft.kind === 'location') {
      const location = latitude.trim() && longitude.trim() ? parseLocation({latitude:Number(latitude),longitude:Number(longitude),label,
        ...(position && String(position.latitude) === latitude && String(position.longitude) === longitude ? position : {})}) : null;
      if (!location) {Alert.alert(t('attachments.invalidLocation'));return;}
      value={kind:'location',location};
    } else {
      if (draft.sizeBytes <= 0 || draft.sizeBytes > attachmentLimit(draft.mediaType)) {Alert.alert(t('attachments.invalidFile'));return;}
      value={...draft,caption:caption.trim()};
    }
    setBusy(true);
    try {await onSend(value);onClose();} catch {Alert.alert(t('media.uploadFailed'),t('attachments.sendError'));setBusy(false);}
  }
  const field = (value:string,onChangeText:(s:string)=>void,key:string,props:Record<string,any>={}) => <TextInput
    style={s.input} value={value} onChangeText={onChangeText} editable={!busy} placeholder={t(key)} accessibilityLabel={t(key)} placeholderTextColor={colors.ink500} {...props} />;
  return <Modal visible animationType="slide" onRequestClose={() => {if (!busy) onClose();}}>
    <KeyboardAvoidingView style={[s.root,{paddingTop:inset.top}]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <Pressable disabled={busy} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')}><Ionicons name="close" size={27} color={colors.ink}/></Pressable>
        <Text style={s.title}>{t('attachments.preview')}</Text>
        <View style={{width:27}}/>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {draft.kind === 'binary' ? <>
          {draft.mediaType === 'image' ? <Image source={{uri:draft.uri}} style={s.media} resizeMode="contain"/> : draft.mediaType === 'video' ?
            <Video source={{uri:draft.uri}} style={s.media} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay={false}/> :
            <Ionicons name={draft.mediaType === 'audio' ? 'musical-notes' : 'document-text'} size={70} color={colors.primary}/>}
          <Text style={s.title}>{draft.fileName}</Text>
          <Text style={s.note}>{(draft.sizeBytes / 1024 / 1024).toFixed(2)} MB · {t('attachments.limit',{size:attachmentLimit(draft.mediaType)/1024/1024})}</Text>
          {field(caption,setCaption,'media.addCaption',{multiline:true,maxLength:1000})}
        </> : draft.kind === 'contact' ? <>
          <Ionicons name="person-circle" size={64} color={colors.primary}/>
          <Text style={s.note}>{t('attachments.contactReview')}</Text>
          {field(name,setName,'attachments.name',{maxLength:160})}
          {field(phones,setPhones,'attachments.phones',{multiline:true,maxLength:204,keyboardType:'phone-pad'})}
          {field(emails,setEmails,'attachments.emails',{multiline:true,maxLength:1274,keyboardType:'email-address',autoCapitalize:'none'})}
        </> : <>
          <Ionicons name="location" size={64} color={colors.primary}/>
          <Text style={s.note}>{t('attachments.staticLocation')}</Text>
          <Pressable style={s.secondary} disabled={locating || busy} onPress={() => {void locate();}} accessibilityRole="button">
            {locating ? <ActivityIndicator/> : <Text style={s.actionText}>{t('attachments.currentLocation')}</Text>}
          </Pressable>
          {field(label,setLabel,'attachments.placeName',{maxLength:160})}
          {field(latitude,setLatitude,'attachments.latitude',{keyboardType:'numbers-and-punctuation',maxLength:22})}
          {field(longitude,setLongitude,'attachments.longitude',{keyboardType:'numbers-and-punctuation',maxLength:22})}
          {position?.accuracy != null ? <Text style={s.note}>{t('attachments.accuracy',{meters:Math.round(position.accuracy)})}</Text> : null}
        </>}
      </ScrollView>
      <Pressable style={[s.send,{marginBottom:Math.max(inset.bottom,12),opacity:busy || locating ? .5 : 1}]} disabled={busy || locating} onPress={() => {void send();}} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff"/> : <Text style={s.sendText}>{t('attachments.send')}</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  </Modal>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#fff'},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:18,borderBottomWidth:1,borderColor:colors.ink100},title:{fontSize:17,fontWeight:'700',color:colors.ink},content:{padding:22,gap:16},media:{width:'100%',height:260,backgroundColor:colors.ink100,borderRadius:12},note:{fontSize:14,color:colors.ink500,lineHeight:22},input:{borderWidth:1,borderColor:colors.ink200,borderRadius:12,padding:13,fontSize:16,color:colors.ink,minHeight:50,textAlign:'auto'},secondary:{padding:15,borderRadius:12,backgroundColor:colors.primaryLight,alignItems:'center'},actionText:{color:colors.primary,fontWeight:'700'},send:{marginHorizontal:20,padding:16,borderRadius:14,backgroundColor:colors.primary,alignItems:'center'},sendText:{color:'#fff',fontSize:16,fontWeight:'700'}});
