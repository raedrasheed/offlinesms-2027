// Isolated visual QA using the same feed frame/header and creator profile header
// as production. Illustrations and sample counts live only in this gallery.
import {useEffect,useState} from 'react';
import {Image,Pressable,ScrollView,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import Svg,{Circle,Ellipse,Path,Rect} from 'react-native-svg';
import {Ionicons} from '@expo/vector-icons';
import '../src/i18n';
import i18n from '../src/i18n';
import {useClipsCopy} from '../src/lib/clipsCopy';
import ClipCardFrame from '../src/components/clips/ClipCardFrame';
import ClipFeedHeader from '../src/components/clips/ClipFeedHeader';
import ClipProfileHeader,{profileStyles as p} from '../src/components/clips/ClipProfileHeader';
import type {ClipItem,ClipProfile} from '../src/lib/clips';
function Moment({variant=0}:{variant?:number}){
  const greens=['#346D69','#548F86','#23535B'];
  return <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
    <Rect width="390" height="844" fill="#A5D5E7"/><Circle cx="312" cy="136" r="42" fill="#FFECC2"/>
    <Path d="M0 267L77 205L133 230L223 171L390 264V415H0Z" fill="#7B9FA9"/><Path d="M0 317L74 276L191 300L269 254L390 302V460H0Z" fill="#B8C5B9"/>
    <Rect y="342" width="390" height="280" fill="#3C99B5"/><Path d="M0 409Q70 393 146 408T390 413M0 452Q90 435 220 453T390 445M0 498Q100 483 230 500T390 493" stroke="#B7E1E6" strokeWidth="3" fill="none"/>
    <Path d="M0 582L390 538V844H0Z" fill="#D4B591"/><Path d="M-10 669L390 619M0 741L390 694M0 821L390 772" stroke="#B49370" strokeWidth="3"/>
    <Ellipse cx="226" cy="671" rx="122" ry="29" fill="#9D7C5D" opacity="0.3"/><Ellipse cx="226" cy="652" rx="108" ry="27" fill="#ECE7DD"/>
    <Path d="M162 559H281L267 638Q223 666 177 637Z" fill="#F8F3E8"/><Path d="M282 577C338 558 333 626 274 620" fill="none" stroke="#F3ECDD" strokeWidth="15"/>
    <Ellipse cx="221" cy="561" rx="60" ry="18" fill="#D7C6AA"/><Ellipse cx="221" cy="562" rx="49" ry="12" fill="#805537"/>
    <Path d="M204 562Q219 545 237 562Q224 579 204 562" fill="#EFE2C7"/><Path d="M216 520Q205 499 218 483M236 520Q249 499 236 483" fill="none" stroke="#F9FBF5" strokeWidth="4" opacity="0.6"/>
    <Path d="M30 0L53 470M374 0L351 364" stroke="#6A7250" strokeWidth="8"/><Path d="M36 69Q-15 31 4 3Q58 18 36 69M42 134Q99 100 91 64Q32 76 42 134M47 220Q-8 184 5 148Q65 162 47 220M368 61Q310 27 320 0Q380 12 368 61M360 145Q409 105 390 77Q346 96 360 145M357 223Q294 184 312 150Q365 167 357 223" fill={greens[variant%3]}/>
    <Ellipse cx="78" cy="731" rx="56" ry="20" fill="#E6D2B4"/><Path d="M31 730Q57 690 83 716Q110 688 128 726Q81 752 31 730" fill="#B67D43"/>
  </Svg>;
}
export default function ClipsGallery(){
  const hash=typeof window==='undefined'?'':window.location.hash;
  const [screen,setScreen]=useState(hash.includes('profile')?'profile':'feed');const [mode,setMode]=useState<'forYou'|'following'>('forYou');
  const [liked,setLiked]=useState(false);const [saved,setSaved]=useState(false);const [followed,setFollowed]=useState(false);
  const {height:windowHeight,width:windowWidth}=useWindowDimensions();const height=Math.max(740,Math.min(900,windowHeight));const width=Math.min(430,windowWidth);const {c}=useClipsCopy();
  useEffect(()=>{void i18n.changeLanguage(hash.includes('en')?'en':'ar');},[]);
  const profile:ClipProfile={uid:'gallery-sara',displayName:c('Sara','سارة'),username:'sara',photoURL:null,privateAccount:false,bio:c('Little moments worth sharing','لحظات بسيطة تستحق المشاركة'),followerCount:2400,followingCount:154,clipCount:12,likeCount:8100,followStatus:followed?'accepted':'none',isOwner:false,blocked:false};
  const clip:ClipItem={id:'gallery-coffee',ownerUid:profile.uid,caption:c('Morning coffee by the sea ☕','قهوة الصباح على البحر ☕'),hashtags:['coffee'],audience:'public',groupId:null,status:'published',allowComments:true,allowDownload:false,durationMs:15000,width:1080,height:1920,createdAtMs:1,publishedAtMs:1,likeCount:1128+(liked?1:0),commentCount:24,shareCount:8,viewCount:19200,likedByMe:liked,savedByMe:saved,followStatus:profile.followStatus,author:profile};
  const noop=()=>{};
  return <View style={s.canvas}><View style={{width,height,backgroundColor:'#fff',overflow:'hidden'}}>
    {screen==='feed'?<><ClipCardFrame clip={clip} height={height} bottomInset={88} own={false} media={<Moment/>} onLike={()=>setLiked(!liked)} onSave={()=>setSaved(!saved)} onFollow={()=>setFollowed(!followed)} onComments={noop} onShare={noop} onMore={noop} onProfile={()=>setScreen('profile')}/>
      <ClipFeedHeader top={40} mode={mode} enabled onMode={setMode} onSearch={noop} onCreate={noop} onProfile={()=>setScreen('profile')}/>
      <View style={s.controls}><Ionicons name="volume-high" size={22} color="#fff"/><View style={s.track}><View style={s.progress}/></View></View></>:<>
      <View style={[p.nav,{marginTop:30}]}><Pressable onPress={()=>setScreen('feed')} style={p.icon}><Ionicons name="chevron-back" size={26} color="#102A3B"/></Pressable><Text style={p.navTitle}>{profile.displayName}</Text><View style={p.icon}><Ionicons name="ellipsis-horizontal" size={24} color="#102A3B"/></View></View>
      <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingBottom:110}}><ClipProfileHeader profile={profile} own={false} tab="profile" onCreate={noop} onDrafts={noop} onRequests={noop} onTab={noop} onFollow={()=>setFollowed(!followed)}/>
        <View style={s.grid}>{Array.from({length:9},(_,index)=><Pressable key={index} onPress={()=>setScreen('feed')} style={[p.tile,{width:(width-40)/3,height:(width-40)/3*1.45}]}><Moment variant={index}/><View style={p.tileFooter}><Ionicons name="play-outline" color="#fff" size={14}/><Text style={p.views}>{(1.9+index*0.3).toFixed(1)}K</Text></View></Pressable>)}</View>
      </ScrollView></>}
    <View pointerEvents="none" style={s.status}><Text style={{color:screen==='feed'?'#fff':'#173B52',fontWeight:'700',fontSize:12}}>10:24</Text><View style={{flexDirection:'row',gap:5}}><Ionicons name="cellular" color={screen==='feed'?'#fff':'#173B52'} size={13}/><Ionicons name="wifi" color={screen==='feed'?'#fff':'#173B52'} size={13}/><Ionicons name="battery-full" color={screen==='feed'?'#fff':'#173B52'} size={15}/></View></View>
    <View style={s.nav}>{[['settings-outline',c('Settings','الإعدادات')],['play-outline',c('Clips','مقاطع')],['ellipse-outline',c('Status','الحالات')],['chatbubbles-outline',c('Chats','المحادثات')]].map(([icon,label],index)=><Pressable key={label} style={[s.navItem,index===1&&s.navSelected]} onPress={()=>index===1&&setScreen('feed')}><Ionicons name={icon as any} size={23} color={index===1?'#1F7BA8':'#203645'}/><Text style={{fontSize:10,fontWeight:'700',color:index===1?'#1F7BA8':'#203645'}}>{label}</Text></Pressable>)}</View>
  </View></View>;
}
const s=StyleSheet.create({canvas:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#DFEFF8'},status:{position:'absolute',top:11,left:23,right:23,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},controls:{position:'absolute',left:24,right:24,bottom:108,flexDirection:'row',alignItems:'center',gap:14},track:{height:3,flex:1,backgroundColor:'#FFFFFF70',borderRadius:3},progress:{height:3,width:'46%',backgroundColor:'#fff',borderRadius:3},nav:{position:'absolute',left:13,right:13,bottom:14,backgroundColor:'#fff',borderRadius:30,height:67,flexDirection:'row',padding:7,shadowColor:'#102A3B',shadowOpacity:.18,shadowRadius:12,shadowOffset:{width:0,height:4}},navItem:{flex:1,alignItems:'center',justifyContent:'center',gap:4,borderRadius:24},navSelected:{backgroundColor:'#DEF3FF'},grid:{flexDirection:'row',flexWrap:'wrap',gap:4}});
