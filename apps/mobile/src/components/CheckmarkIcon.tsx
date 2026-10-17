import {Ionicons} from '@expo/vector-icons';

export const RECEIPT_READ='#34B7F1';
export const RECEIPT_MUTED='#8A9C92';
export type MessageCheckState='sent'|'delivered'|'read';
/** One glyph family for receipts and selection checks; never font-dependent ✓ text. */
export function CheckmarkIcon({double=false,color=RECEIPT_MUTED,size=15}:{double?:boolean;color?:string;size?:number}){
  return <Ionicons name={double?'checkmark-done':'checkmark'} color={color} size={size} style={{direction:'ltr'}}/>;
}
export function MessageStatusIcon({state,size=15}:{state:MessageCheckState;size?:number}){
  return <CheckmarkIcon double={state!=='sent'} color={state==='read'?RECEIPT_READ:RECEIPT_MUTED} size={size}/>;
}
