import {View,Text,StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTranslation} from 'react-i18next';
import type {Message} from '../../lib/conversations';
import {MessageStatusIcon,RECEIPT_MUTED,RECEIPT_READ,type MessageCheckState} from '../CheckmarkIcon';

export function MessageReceipt({message,isGroup,memberCount,overlay=false}:{message:Pick<Message,'deliveredCount'|'readCount'>;isGroup:boolean;memberCount?:number;overlay?:boolean}){
  const {t}=useTranslation();
  const delivered=Math.max(0,message.deliveredCount ?? 0),read=Math.max(0,message.readCount ?? 0);
  const state:MessageCheckState=read>0?'read':delivered>0?'delivered':'sent';
  const textColor=overlay?'#FFFFFF':'#667B70';
  const label=isGroup?`${t('receipts.deliveredTo')} ${delivered}, ${t('receipts.readBy')} ${read}`:t(`receipts.${state}`);
  return <View style={s.row} accessible accessibilityLabel={label}>
    <MessageStatusIcon state={state}/>
    {isGroup && memberCount && memberCount<20?<Text style={[s.count,{color:textColor}]}>{t('receipts.readBy')} {read}</Text>:isGroup?<>
      <Text style={[s.count,{color:textColor}]}>{delivered}</Text>
      <Ionicons name="eye-outline" size={12} color={read>0?RECEIPT_READ:RECEIPT_MUTED}/>
      <Text style={[s.count,{color:textColor}]}>{read}</Text>
    </>:null}
  </View>;
}
const s=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:3,direction:'ltr'},count:{fontSize:11}});
