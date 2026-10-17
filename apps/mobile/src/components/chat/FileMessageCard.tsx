import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../lib/conversations';
import { filePresentation } from '../../media/filePresentation';
import { attachmentCardStyles, attachmentCardWidth } from './attachmentCardStyles';

export function FileMessageCard({message,mine,busy,uploading,failed,cached,ready,progress,onPress,onLongPress,footer}: {
  message:Message;mine:boolean;busy:boolean;uploading:boolean;failed:boolean;cached:boolean;ready:boolean;progress:number;
  onPress:()=>void;onLongPress?:()=>void;footer?:ReactNode;
}) {
  const {t}=useTranslation();const {width}=useWindowDimensions();
  const file=filePresentation(message.media?.fileName,message.media?.mimeType,message.media?.sizeBytes);
  const disabled=busy || uploading || !mine && !ready;
  const action=t(failed?'media.retryUpload':cached?'attachments.open':'attachments.download');
  return <View style={[attachmentCardStyles.card,{width:attachmentCardWidth(width)}]}>
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={300} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={`${message.media?.fileName || t('media.file')}, ${action}`}
      accessibilityState={{disabled,busy:busy || uploading}} style={s.body}>
      <View style={[s.document,{backgroundColor:file.color}]}>
        <View style={s.fold}/><Text style={[s.badge,file.badge.length>1 && s.smallBadge]}>{file.badge}</Text>
      </View>
      <View style={s.details}>
        <Text style={s.name} numberOfLines={2}>{message.media?.fileName || t('media.file')}</Text>
        <Text style={s.metadata}>{file.type} · {file.size}</Text>
        {uploading || busy ? <Text style={s.metadata}>{progress}%</Text> : !ready && !failed ? <Text style={s.metadata}>{t('attachments.waitingUpload')}</Text> : null}
      </View>
      {busy || uploading ? <ActivityIndicator size="small" color="#789883"/> :
        <Ionicons name={failed?'refresh':cached?'open-outline':'download-outline'} size={28} color={failed?'#CC4141':'#8BAA90'}/>}
    </Pressable>
    {message.caption?.trim()?<Text style={s.caption}>{message.caption.trim()}</Text>:null}
    <View style={[attachmentCardStyles.receipt,s.footer]}>{footer}</View>
  </View>;
}
const s=StyleSheet.create({
  body:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:18,paddingVertical:14,minHeight:84,backgroundColor:'rgba(17,27,33,0.035)'},
  document:{width:25,height:31,borderRadius:3,alignItems:'center',justifyContent:'flex-end',paddingBottom:4,overflow:'hidden'},
  fold:{position:'absolute',top:0,right:0,width:8,height:8,backgroundColor:'rgba(255,255,255,0.45)',borderBottomLeftRadius:2},
  badge:{fontSize:16,fontWeight:'800',color:'#fff'},smallBadge:{fontSize:8},details:{flex:1,gap:3},
  name:{fontSize:14,lineHeight:20,color:'#111B21',textAlign:'auto'},metadata:{fontSize:11,lineHeight:15,color:'#587064',textAlign:'auto'},
  caption:{fontSize:15,lineHeight:21,color:'#111B21',paddingHorizontal:12,paddingTop:6},footer:{minHeight:25,paddingTop:3},
});
