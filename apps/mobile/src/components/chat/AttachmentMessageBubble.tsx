import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, Alert, Linking, StyleSheet, ActivityIndicator } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../lib/conversations';
import { colors } from '../../theme';
import { ensureCached, cachedMediaUri } from '../../media/mediaCache';
import { useTransfer } from '../../hooks/useTransfer';
import { togglePlay, subscribePlayback } from '../../media/audio/audioPlayer';
import { AppContactCard } from './AppContactCard';
import { LocationMessageCard } from './LocationMessageCard';
import { FileMessageCard } from './FileMessageCard';

/** Large binaries do not download or mount a decoder until explicitly opened. */
export function AttachmentMessageBubble({message:m,mine,onRetry,onLongPress,onOpenContact,myUid,footer,locationVisible=false}: {
  message:Message;mine:boolean;onRetry:()=>void;onLongPress?:()=>void;
  onOpenContact?:(uid:string)=>Promise<void>;myUid?:string;footer?:ReactNode;locationVisible?:boolean;
}) {
  const {t}=useTranslation();
  const transfer=useTransfer(m.id);
  const [busy,setBusy]=useState(false);
  const opening=useRef(false);
  const [cached,setCached]=useState<string|null>(m.media?.localUri ?? null);
  const [playing,setPlaying]=useState(false);
  useEffect(() => {let active=true;setCached(m.media?.localUri ?? null);void cachedMediaUri(m).then(uri => {if(active && uri)setCached(uri);}).catch(() => {});return () => {active=false;};},[m.id,m.media?.downloadURL]);
  useEffect(() => subscribePlayback(st => setPlaying(st.id === m.id && st.playing)),[m.id]);
  const ready=m.media?.uploadStatus === 'uploaded';
  const failed=mine && m.media?.uploadStatus === 'failed';
  const uploading=mine && !ready && !failed;
  const openLink=async (uri:string) => {try {await Linking.openURL(uri);}catch{Alert.alert(t('attachments.openError'));}};
  async function openBinary(share=false) {
    if (failed) {onRetry();return;}
    if (opening.current || !ready && !m.media?.localUri) return;
    opening.current=true;setBusy(true);
    try {
      const uri=cached || await ensureCached(m);
      if (!uri) throw new Error('download-failed');
      setCached(uri);
      if (share || m.type === 'file') {
        if (!(await Sharing.isAvailableAsync())) throw new Error('sharing-unavailable');
        await Sharing.shareAsync(uri,{mimeType:m.media?.mimeType,dialogTitle:m.media?.fileName || t('media.file')});
      } else if (m.type === 'audio') await togglePlay(m.id,uri);
    } catch {Alert.alert(t('attachments.openError'),t('attachments.retryHint'));}
    finally {opening.current=false;setBusy(false);}
  }
  async function saveContact() {
    if (!m.contact) return;
    try {await Contacts.presentFormAsync(undefined,{name:m.contact.name,firstName:m.contact.name,contactType:Contacts.ContactTypes.Person,
      phoneNumbers:m.contact.phones.map(number => ({number,label:'mobile'})),emails:m.contact.emails.map(email => ({email,label:'other'}))});}
    catch {Alert.alert(t('attachments.openError'));}
  }
  if (m.type === 'location' && m.location) return <LocationMessageCard location={m.location} visible={locationVisible} footer={footer} onLongPress={onLongPress} onOpen={uri=>{void openLink(uri);}}/>;
  if (m.type === 'contact' && m.contact?.uid) return <AppContactCard contact={{...m.contact,uid:m.contact.uid}} myUid={myUid} onOpen={onOpenContact} onLongPress={onLongPress} footer={footer}/>;
  if (m.type === 'contact' && m.contact) return <View style={s.card}>
    <Pressable style={s.row} onPress={() => {void saveContact();}} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={t('attachments.saveContact')}>
      <View style={s.icon}><Ionicons name="person" size={27} color={colors.primary}/></View><Text style={[s.title,s.details]}>{m.contact.name}</Text>
    </Pressable>
    {m.contact.phones.map(phone => <Pressable key={phone} onPress={() => {void openLink(`tel:${phone.replace(/[^+\d]/g,'')}`);}} accessibilityRole="button"><Text style={s.action}>{phone}</Text></Pressable>)}
    {m.contact.emails.map(email => <Pressable key={email} onPress={() => {void openLink(`mailto:${encodeURIComponent(email)}`);}} accessibilityRole="button"><Text style={s.action}>{email}</Text></Pressable>)}
    <Pressable onPress={() => {void saveContact();}} accessibilityRole="button"><Text style={s.action}>{t('attachments.saveContact')}</Text></Pressable>
  </View>;
  const percent=Math.round((transfer?.progress ?? m.media?.uploadProgress ?? 0)*100);
  if(m.type==='file')return <FileMessageCard message={m} mine={mine} busy={busy} uploading={uploading} failed={failed}
    cached={!!cached} ready={ready} progress={percent} onPress={()=>{void openBinary();}} onLongPress={onLongPress} footer={footer}/>;
  return <View style={s.card}>
    <Pressable style={s.row} onLongPress={onLongPress} disabled={busy || uploading || !mine && !ready} onPress={() => {void openBinary();}} accessibilityRole="button" accessibilityLabel={failed ? t('media.retryUpload') : t('attachments.open')}>
      <View style={s.icon}>{busy || uploading ? <ActivityIndicator color={colors.primary}/> : <Ionicons name={failed ? 'refresh' : m.type === 'audio' ? playing ? 'pause' : 'play' : 'document-text'} size={27} color={colors.primary}/>}</View>
      <View style={s.details}>
        <Text style={s.title} numberOfLines={2}>{m.media?.fileName || t(`attachments.${m.type}`)}</Text>
        <Text style={s.meta}>{((m.media?.sizeBytes ?? 0)/1024/1024).toFixed(2)} MB</Text>
        <Text style={s.action}>{failed ? t('media.retryUpload') : busy || uploading ? `${percent}%` : !mine && !ready ? t('attachments.waitingUpload') : t(cached ? 'attachments.open' : 'attachments.download')}</Text>
      </View>
    </Pressable>
    {!!m.caption && <Text style={s.caption}>{m.caption}</Text>}
    {cached && ready ? <Pressable disabled={busy} onPress={() => {void openBinary(true);}} accessibilityRole="button"><Text style={s.action}>{t('attachments.shareSave')}</Text></Pressable> : null}
  </View>;
}
const s=StyleSheet.create({card:{minWidth:210,maxWidth:270,gap:10,padding:5},row:{flexDirection:'row',alignItems:'center',gap:12},icon:{width:49,height:49,backgroundColor:colors.primaryLight,borderRadius:13,alignItems:'center',justifyContent:'center'},details:{flex:1},title:{fontSize:15,fontWeight:'700',color:colors.ink},meta:{fontSize:12,color:colors.ink500,marginTop:4},action:{fontSize:13,fontWeight:'600',color:colors.primary,paddingVertical:5},caption:{fontSize:15,color:colors.ink}});
