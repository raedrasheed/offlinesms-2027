import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ClipItem } from '../../lib/clips';
import { useClipsCopy, clipCount } from '../../lib/clipsCopy';
import type { ReactNode } from 'react';

export type ClipCardFrameProps={clip:ClipItem;own?:boolean;media:ReactNode;height:number;bottomInset:number;onLike:()=>void;onSave:()=>void;onComments:()=>void;onShare:()=>void;onMore:()=>void;onProfile:()=>void;onFollow:()=>void;busy?:boolean};
function Action({icon,label,count,color='#fff',onPress,disabled}:{icon:keyof typeof Ionicons.glyphMap;label:string;count?:number;color?:string;onPress:()=>void;disabled?:boolean}){
  return <Pressable onPress={onPress} disabled={disabled} style={s.action} accessibilityRole="button" accessibilityLabel={label}>
    <Ionicons name={icon} size={31} color={color}/>{count!==undefined?<Text style={s.actionCount}>{clipCount(count)}</Text>:null}
  </Pressable>;
}
export default function ClipCardFrame(p:ClipCardFrameProps){
  const {c}=useClipsCopy(); const own=!!p.own;
  const name=p.clip.author.displayName || c('Creator','صانع المحتوى');
  return <View style={{height:p.height,backgroundColor:'#0C141C'}} testID={`clip-card-${p.clip.id}`}>
    {p.media}
    <View pointerEvents="none" style={s.topShade}/><View pointerEvents="none" style={[s.bottomShade,{bottom:p.bottomInset+48}]}/>
    <View style={[s.rail,{bottom:p.bottomInset+90}]}>
      <Pressable onPress={p.onProfile} style={s.avatarButton} accessibilityLabel={c('Open creator profile','عرض ملف الناشر')}>
        {p.clip.author.photoURL?<Image source={{uri:p.clip.author.photoURL}} style={s.avatar}/>:<View style={[s.avatar,s.avatarEmpty]}><Text style={s.initial}>{name.slice(0,1)}</Text></View>}
      </Pressable>
      {!own && p.clip.followStatus!=='accepted'?<Pressable onPress={p.onFollow} disabled={p.busy} style={s.follow} accessibilityLabel={p.clip.followStatus==='pending'?c('Follow request pending','طلب المتابعة قيد الانتظار'):c('Follow creator','متابعة الناشر')}>
        <Ionicons name={p.clip.followStatus==='pending'?'time-outline':'add'} size={18} color="#fff"/>
      </Pressable>:null}
      <Action icon={p.clip.likedByMe?'heart':'heart-outline'} label={c('Like clip','الإعجاب بالمقطع')} count={p.clip.likeCount} color={p.clip.likedByMe?'#FF657B':'#fff'} onPress={p.onLike} disabled={p.busy}/>
      <Action icon="chatbubble-outline" label={c('Comments','التعليقات')} count={p.clip.commentCount} onPress={p.onComments}/>
      <Action icon={p.clip.savedByMe?'bookmark':'bookmark-outline'} label={p.clip.savedByMe?c('Unsave clip','إزالة من المحفوظات'):c('Save clip','حفظ المقطع')} onPress={p.onSave} disabled={p.busy}/>
      <Action icon="arrow-redo-outline" label={c('Share clip','مشاركة المقطع')} onPress={p.onShare}/>
      <Action icon="ellipsis-horizontal" label={c('More options','المزيد من الخيارات')} onPress={p.onMore}/>
    </View>
    <View pointerEvents="box-none" style={[s.caption,{bottom:p.bottomInset+67}]}>
      <Pressable onPress={p.onProfile}><Text style={s.creator}>{name}</Text>{p.clip.author.username?<Text style={s.username}>@{p.clip.author.username.replace(/^@/,'')}</Text>:null}</Pressable>
      {!!p.clip.caption && <Text style={s.captionText} numberOfLines={3}>{p.clip.caption}</Text>}
      {p.clip.audience!=='public'?<Text style={s.audience}><Ionicons name="lock-closed-outline" size={12}/> {p.clip.audience==='group'?c('Group clip','مقطع مجموعة'):p.clip.audience==='followers'?c('Approved followers','المتابعون المقبولون'):c('Only you','أنت فقط')}</Text>:null}
    </View>
  </View>;
}
const s=StyleSheet.create({topShade:{position:'absolute',top:0,left:0,right:0,height:115,backgroundColor:'#0002'},bottomShade:{position:'absolute',left:0,right:0,height:180,backgroundColor:'#0002'},rail:{position:'absolute',left:13,alignItems:'center',gap:9,width:50},action:{alignItems:'center',minHeight:44,minWidth:44,justifyContent:'center'},actionCount:{color:'#fff',fontSize:12,fontWeight:'700',textShadowColor:'#0008',textShadowRadius:4},avatarButton:{marginBottom:2},avatar:{height:45,width:45,borderRadius:24,borderWidth:2,borderColor:'#fff'},avatarEmpty:{backgroundColor:'#1F7BA8',justifyContent:'center',alignItems:'center'},initial:{color:'#fff',fontSize:20,fontWeight:'800'},follow:{backgroundColor:'#1F9CD0',height:23,width:23,borderRadius:12,alignItems:'center',justifyContent:'center',marginTop:-22,marginBottom:1,borderWidth:1,borderColor:'#fff'},caption:{position:'absolute',right:21,left:80,gap:6,alignItems:'flex-end'},creator:{color:'#fff',fontWeight:'800',fontSize:18,textAlign:'right',textShadowColor:'#0007',textShadowRadius:4},username:{color:'#fff',fontSize:13,textAlign:'right',marginTop:3},captionText:{color:'#fff',fontSize:15,lineHeight:23,textAlign:'right',textShadowColor:'#0007',textShadowRadius:4},audience:{fontSize:11,color:'#E3F1FA',textAlign:'right'}});
