import { Platform } from 'react-native';
import * as Contacts from 'expo-contacts';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import type { AttachmentDraft } from '../components/chat/AttachmentComposer';
import { attachmentMimeAllowed, attachmentLimit, inferAttachmentMime, DOCUMENT_MIMES } from './attachmentModel';

export async function selectAttachment(key: 'file' | 'audio' | 'video' | 'gif' | 'contact' | 'location'): Promise<AttachmentDraft | null> {
  if (key === 'location') return {kind:'location'};
  if (key === 'contact') {
    if (Platform.OS === 'web') return {kind:'contact'};
    if (Platform.OS === 'android' && !(await Contacts.requestPermissionsAsync()).granted) return {kind:'contact'};
    const c = await Contacts.presentContactPickerAsync();
    if (!c) return null;
    return {kind:'contact',contact:{name:c.name || [c.firstName,c.lastName].filter(Boolean).join(' '),
      phones:(c.phoneNumbers ?? []).map(p => p.number ?? '').filter(Boolean).slice(0,5),
      emails:(c.emails ?? []).map(p => p.email ?? '').filter(Boolean).slice(0,5)}};
  }
  let uri:string, fileName:string, mimeType:string, sizeBytes:number;
  let width:number|undefined,height:number|undefined,durationMs:number|undefined;
  const mediaType = key === 'gif' ? 'image' : key;
  if (key === 'video') {
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Videos});
    if (result.canceled || !result.assets[0]) return null;
    const a=result.assets[0];uri=a.uri;fileName=a.fileName || 'video.mp4';mimeType=inferAttachmentMime(fileName,a.mimeType);sizeBytes=a.fileSize ?? 0;
    width=a.width;height=a.height;durationMs=a.duration ?? undefined;
  } else {
    const result=await DocumentPicker.getDocumentAsync({type:key === 'gif' ? 'image/gif' : key === 'audio' ? 'audio/*' : DOCUMENT_MIMES,copyToCacheDirectory:true,multiple:false});
    if (result.canceled || !result.assets[0]) return null;
    const a=result.assets[0];uri=a.uri;fileName=a.name;mimeType=inferAttachmentMime(fileName,a.mimeType);sizeBytes=a.size ?? 0;
  }
  if (!sizeBytes) {const info=await FileSystem.getInfoAsync(uri);sizeBytes=info.exists && !info.isDirectory ? info.size : 0;}
  if (!attachmentMimeAllowed(mediaType,mimeType) || (key === 'gif' && mimeType !== 'image/gif') || !sizeBytes || sizeBytes > attachmentLimit(mediaType)) throw new Error('attachment-invalid');
  return {kind:'binary',mediaType,uri,fileName,mimeType,sizeBytes,width,height,durationMs};
}
