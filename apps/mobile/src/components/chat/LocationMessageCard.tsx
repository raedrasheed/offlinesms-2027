import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { locationUrl, type LocationAttachment } from '../../media/attachmentModel';
import { locationMapTiles, TILE_SIZE, MAP_ATTRIBUTION, MAP_COPYRIGHT_URL } from '../../media/locationMap';
import { cachedMapTile } from '../../media/mapTileCache';
import { attachmentCardWidth } from './attachmentCardStyles';

export function LocationMessageCard({location,visible,footer,onLongPress,onOpen}: {
  location:LocationAttachment;visible:boolean;footer?:ReactNode;onLongPress?:()=>void;onOpen:(url:string)=>void;
}) {
  const {t}=useTranslation();const window=useWindowDimensions();
  const width=attachmentCardWidth(window.width,true)-4,height=width*9/16;
  const key=`${location.latitude}/${location.longitude}/${width}`;
  const tiles=useMemo(()=>locationMapTiles(location,width,height),[location.latitude,location.longitude,width,height]);
  const [state,setState]=useState<{key:string;uris:Array<string|null>;failed:boolean}>({key:'',uris:[],failed:false});
  useEffect(()=>{
    if(!visible)return;
    let current=true;
    const timer=setTimeout(()=>{if(current)setState({key,uris:[],failed:true});},12000);
    void Promise.all(tiles.map(tile=>cachedMapTile(tile,()=>current))).then(uris=>{
      if(current){clearTimeout(timer);setState({key,uris,failed:!tiles.length || uris.some(uri=>!uri)});}
    });
    return()=>{current=false;clearTimeout(timer);};
  },[key,visible,tiles]);
  const loaded=state.key===key && state.uris.length===tiles.length && tiles.length>0 && !state.failed;
  const failed=state.key===key && state.failed;
  return <View style={s.mat}>
    <Pressable style={[s.frame,{width,height}]} onPress={()=>onOpen(locationUrl(location))} onLongPress={onLongPress} delayLongPress={300}
      accessibilityRole="imagebutton" accessibilityLabel={`${t('attachments.openMaps')}: ${location.label || `${location.latitude}, ${location.longitude}`}`}>
      {loaded?tiles.map((tile,i)=><Image key={`${key}/${tile.key}`} source={{uri:state.uris[i]!}} resizeMode="stretch"
        onError={()=>setState({key,uris:[],failed:true})} style={{position:'absolute',left:tile.left,top:tile.top,width:TILE_SIZE,height:TILE_SIZE}}/>):
        <View style={s.placeholder}>{failed?<Text style={s.fallback}>{t('attachments.mapPreviewUnavailable')}</Text>:<ActivityIndicator size="small" color="#78909C"/>}</View>}
      {loaded?<Svg pointerEvents="none" width={28} height={38} viewBox="0 0 28 38" style={{position:'absolute',left:width/2-14,top:height/2-38}}>
        <Path d="M14 0C6.27 0 0 6.2 0 14c0 10 14 24 14 24s14-14 14-24C28 6.2 21.73 0 14 0Z" fill="#EA4335"/>
        <Circle cx={14} cy={14} r={5} fill="#B9271F"/>
      </Svg>:null}
      <Svg pointerEvents="none" width={width} height={42} style={s.shade}>
        <Defs><LinearGradient id="mapShade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#000" stopOpacity={0}/><Stop offset="1" stopColor="#000" stopOpacity={0.42}/></LinearGradient></Defs>
        <Rect width={width} height={42} fill="url(#mapShade)"/>
      </Svg>
      {loaded?<Pressable style={[s.attribution,width<240 && s.attributionTop]} accessibilityRole="link" accessibilityLabel={MAP_ATTRIBUTION}
        onPress={event=>{event.stopPropagation();void Linking.openURL(MAP_COPYRIGHT_URL).catch(()=>{});}}>
        <Text style={s.attributionText}>{MAP_ATTRIBUTION}</Text>
      </Pressable>:null}
      <View style={s.footer}>{footer}</View>
    </Pressable>
  </View>;
}
const s=StyleSheet.create({
  mat:{padding:2,direction:'ltr'},frame:{borderRadius:6,overflow:'hidden',backgroundColor:'#E8ECEF'},
  placeholder:{flex:1,alignItems:'center',justifyContent:'center',padding:22},fallback:{fontSize:13,color:'#52646B',textAlign:'center',lineHeight:20},
  shade:{position:'absolute',left:0,bottom:0},footer:{position:'absolute',right:6,bottom:5,flexDirection:'row',alignItems:'center',gap:4},
  attribution:{position:'absolute',left:3,bottom:3,backgroundColor:'rgba(255,255,255,0.85)',borderRadius:2,paddingHorizontal:2,paddingVertical:1},
  attributionTop:{bottom:undefined,top:3},attributionText:{fontSize:9,color:'#31424B'},
});
