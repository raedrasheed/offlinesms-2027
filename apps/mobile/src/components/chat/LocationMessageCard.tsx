import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { locationUrl, type LocationAttachment } from '../../media/attachmentModel';
import { locationMapTiles, TILE_SIZE, MAP_ATTRIBUTIONS } from '../../media/locationMap';
import { cachedMapTile } from '../../media/mapTileCache';
import {drawMapTile,visibleMapLabels,type MapDrawing} from '../../media/vectorMap';
import { attachmentCardWidth } from './attachmentCardStyles';

export function LocationMessageCard({location,visible,footer,onLongPress,onOpen}: {
  location:LocationAttachment;visible:boolean;footer?:ReactNode;onLongPress?:()=>void;onOpen:(url:string)=>void;
}) {
  const {t,i18n}=useTranslation();const window=useWindowDimensions();
  const language=i18n.language || 'en',svgId=useId().replace(/[^a-zA-Z0-9]/g,'');
  const width=attachmentCardWidth(window.width,true)-4,height=width*9/16;
  const key=`${location.latitude}/${location.longitude}/${width}/${language}`;
  const tiles=useMemo(()=>locationMapTiles(location,width,height),[location.latitude,location.longitude,width,height]);
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;drawings:MapDrawing[];failed:boolean}>({key:'',drawings:[],failed:false});
  useEffect(()=>{
    if(!visible)return;
    let current=true;
    setState(previous=>previous.key===key && previous.drawings.length?previous:{key,drawings:[],failed:false});
    const timer=setTimeout(()=>{if(current)setState({key,drawings:[],failed:true});},20000);
    void Promise.all(tiles.map(tile=>cachedMapTile(tile,()=>current))).then(data=>{
      if(!current)return;
      if(!tiles.length || data.some(tile=>!tile))throw Error('map-unavailable');
      const drawings=data.map((tile,i)=>drawMapTile(tile!,tiles[i],width,height,language));
      clearTimeout(timer);setState({key,drawings,failed:false});
    }).catch(()=>{if(current){clearTimeout(timer);setState({key,drawings:[],failed:true});}});
    return()=>{current=false;clearTimeout(timer);};
  },[key,visible,tiles,attempt]);
  const loaded=state.key===key && state.drawings.length===tiles.length && tiles.length>0 && !state.failed;
  const failed=state.key===key && state.failed;
  const labels=useMemo(()=>visibleMapLabels(state.drawings,width,height),[state.drawings,width,height]);
  return <View style={s.mat}>
    <Pressable style={[s.frame,{width,height}]} onPress={()=>onOpen(locationUrl(location))} onLongPress={onLongPress} delayLongPress={300}
      accessibilityRole="imagebutton" accessibilityLabel={`${t('attachments.openMaps')}: ${location.label || `${location.latitude}, ${location.longitude}`}`}>
      {loaded?<Svg pointerEvents="none" width={width} height={height} testID="location-vector-map">
        <Rect width={width} height={height} fill="#F5F1E8"/>
        <Defs>{tiles.map((tile,i)=><ClipPath id={`${svgId}tile${i}`} key={tile.key}><Rect x={tile.left} y={tile.top} width={TILE_SIZE} height={TILE_SIZE}/></ClipPath>)}</Defs>
        {state.drawings.map((drawing,i)=><G key={tiles[i].key} clipPath={`url(#${svgId}tile${i})`}>
          {drawing.paths.map((path,j)=><Path key={j} {...path} fillRule="nonzero" strokeLinejoin="round" strokeLinecap="round"/>)}
        </G>)}
        {labels.map((label,i)=><SvgText key={i} x={label.x} y={label.y} textAnchor="middle" fontSize={10} fill="#53646A"
          stroke="#FFFFFF" strokeWidth={0.25} rotation={label.angle} origin={`${label.x}, ${label.y}`}>{label.text}</SvgText>)}
      </Svg>:
        <View style={s.placeholder}>{failed?<><Text style={s.fallback}>{t('attachments.mapPreviewUnavailable')}</Text>
          <Pressable onPress={event=>{event.stopPropagation();setAttempt(n=>n+1);}} accessibilityRole="button" accessibilityLabel={t('attachments.retryMap')}>
            <Text style={s.retry}>{t('attachments.retryMap')}</Text>
          </Pressable></>:<ActivityIndicator size="small" color="#78909C"/>}</View>}
      {loaded?<Svg pointerEvents="none" width={28} height={38} viewBox="0 0 28 38" style={{position:'absolute',left:width/2-14,top:height/2-38}}>
        <Path d="M14 0C6.27 0 0 6.2 0 14c0 10 14 24 14 24s14-14 14-24C28 6.2 21.73 0 14 0Z" fill="#EA4335"/>
        <Circle cx={14} cy={14} r={5} fill="#B9271F"/>
      </Svg>:null}
      <Svg pointerEvents="none" width={width} height={42} style={s.shade}>
        <Defs><LinearGradient id={`${svgId}shade`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#000" stopOpacity={0}/><Stop offset="1" stopColor="#000" stopOpacity={0.42}/></LinearGradient></Defs>
        <Rect width={width} height={42} fill={`url(#${svgId}shade)`}/>
      </Svg>
      {loaded?<View style={s.attribution}>{MAP_ATTRIBUTIONS.map(credit=><Pressable key={credit.url} accessibilityRole="link" accessibilityLabel={credit.label}
        onPress={event=>{event.stopPropagation();void Linking.openURL(credit.url).catch(()=>{});}}>
        <Text style={s.attributionText}>{credit.label}</Text>
      </Pressable>)}</View>:null}
      <View style={s.footer}>{footer}</View>
    </Pressable>
  </View>;
}
const s=StyleSheet.create({
  mat:{padding:2,direction:'ltr'},frame:{borderRadius:6,overflow:'hidden',backgroundColor:'#E8ECEF'},
  placeholder:{flex:1,alignItems:'center',justifyContent:'center',padding:22},fallback:{fontSize:13,color:'#52646B',textAlign:'center',lineHeight:20},
  shade:{position:'absolute',left:0,bottom:0},footer:{position:'absolute',right:6,bottom:5,flexDirection:'row',alignItems:'center',gap:4},
  attribution:{position:'absolute',left:3,top:3,maxWidth:'98%',flexDirection:'row',flexWrap:'wrap',gap:3,backgroundColor:'rgba(255,255,255,0.85)',borderRadius:2,paddingHorizontal:2,paddingVertical:1},
  attributionText:{fontSize:8.5,color:'#31424B'},retry:{color:'#1F7BA8',fontSize:12,fontWeight:'600',padding:8},
});
