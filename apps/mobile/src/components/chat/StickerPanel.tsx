// Composer sticker panel: recently used + each pack. Tap sends; long-press
// shows a large preview first (release / tap "Send" to send it). Images are
// bundled with the app and only decoded when a cell is on screen.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, Image, Modal, StyleSheet, useWindowDimensions, Alert, ActivityIndicator, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { isRTL } from '../../i18n';
import { STICKER_PACKS, findSticker, stickerKey, parseStickerKey, type StickerDef } from '../../lib/stickers';
import { createRecentStore } from '../../lib/recents';
import { STICKER_SOURCES } from './stickerSources';
import { customStickerUri, deleteCustomSticker, loadCustomStickers, type CustomSticker } from '../../lib/customStickers';
import { pickStickerImage, removeStickerTemp, type StickerSource } from '../../media/stickerImage';
import { STICKER_LIBRARY_MAX } from '../../lib/stickerEditorModel';
import { StickerEditor, type StickerEditorHandle } from './StickerEditor';

const RECENT_MAX = 16;
const stores = new Map<string, ReturnType<typeof createRecentStore<string>>>();
function recentStore(uid: string) {
  let s = stores.get(uid);
  if (!s) { s = createRecentStore<string>(`recents.sticker.v1:${uid}`, RECENT_MAX); stores.set(uid, s); }
  return s;
}

export type PickedSticker = { packId: string; stickerId: string; alt: string }
  | { custom: CustomSticker; uri: string };

type Row = { key: string; header?: string; cells?: Array<StickerDef & { packId: string }>; custom?: CustomSticker[] };

export function StickerPanel({ uid, onSend }: { uid: string; onSend: (s: PickedSticker) => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const { width } = useWindowDimensions();
  const customSupported=Platform.OS!=='web';
  const columns = Math.max(3, Math.floor(width / 96));
  const cell = Math.floor((width - 16) / columns);
  const [recents, setRecents] = useState<string[]>([]);
  const [preview, setPreview] = useState<(StickerDef & { packId: string }) | null>(null);
  const [custom, setCustom] = useState<CustomSticker[]>([]), [customPreview, setCustomPreview] = useState<CustomSticker | null>(null);
  const [editor, setEditor] = useState<{source:StickerSource;previous?:CustomSticker} | null>(null);
  const [busy, setBusy] = useState(false), [libraryError, setLibraryError] = useState(false);
  const alive=useRef(true),importing=useRef(false);
  const editorRef=useRef<StickerEditorHandle>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(() => { let active=true;
    void recentStore(uid).load().then(value=>{if(active)setRecents(value);});
    if(customSupported)void loadCustomStickers(uid).then(value=>{if(active)setCustom(value);}).catch(()=>{if(active)setLibraryError(true);});
    return()=>{active=false;};
  }, [uid]);
  useEffect(()=>()=>{if(editor && !editor.previous)void removeStickerTemp(editor.source.uri);},[editor]);
  async function createSticker() {
    if(importing.current)return;
    if(custom.length>=STICKER_LIBRARY_MAX){Alert.alert(t('stickers.libraryFull'));return;}
    importing.current=true;setBusy(true);
    try {const source=await pickStickerImage();if(source){if(alive.current)setEditor({source});else void removeStickerTemp(source.uri);}}
    catch(error:any){if(alive.current)Alert.alert(t('stickers.importError'),t(error?.message==='sticker-image-too-large'?'stickers.imageTooLarge':'stickers.tryAgain'));}
    finally{importing.current=false;if(alive.current)setBusy(false);}
  }
  function editCustom(sticker:CustomSticker){
    setCustomPreview(null);
    setEditor({previous:sticker,source:{uri:customStickerUri(uid,sticker,true),width:sticker.sourceWidth,height:sticker.sourceHeight}});
  }
  function removeCustom(sticker:CustomSticker){
    Alert.alert(t('stickers.deleteTitle'),t('stickers.deleteBody'),[
      {text:t('common.cancel'),style:'cancel'},
      {text:t('common.delete'),style:'destructive',onPress:()=>{
        setCustomPreview(null);
        void deleteCustomSticker(uid,sticker.id).then(setCustom).catch(()=>Alert.alert(t('stickers.saveError'),t('stickers.tryAgain')));
      }},
    ]);
  }
  function sendCustom(sticker:CustomSticker){setCustomPreview(null);onSend({custom:sticker,uri:customStickerUri(uid,sticker)});}

  const rows = useMemo(() => {
    const out: Row[] = [];
    if(custom.length){
      out.push({key:'custom-title',header:t('stickers.mine')});
      for(let i=0;i<custom.length;i+=columns)out.push({key:`custom:${i}`,custom:custom.slice(i,i+columns)});
    }
    const push = (key: string, header: string, list: Array<StickerDef & { packId: string }>) => {
      if (!list.length) return;
      out.push({ key: `h:${key}`, header });
      for (let i = 0; i < list.length; i += columns) out.push({ key: `${key}:${i}`, cells: list.slice(i, i + columns) });
    };
    const recent = recents.map(parseStickerKey).filter(Boolean)
      .map(r => findSticker(r!.packId, r!.stickerId)!).filter(Boolean);
    push('recent', t('stickers.recent'), recent);
    for (const p of STICKER_PACKS) push(p.id, t(`stickers.pack.${p.id}`), p.stickers.map(st => ({ ...st, packId: p.id })));
    return out;
  }, [recents, custom, columns, t]);

  const send = useCallback((st: StickerDef & { packId: string }) => {
    setPreview(null);
    onSend({ packId: st.packId, stickerId: st.id, alt: st.alt });
    void recentStore(uid).add(stickerKey(st.packId, st.id)).then(setRecents);
  }, [onSend, uid]);

  const name = (st: StickerDef) => (i18n.language?.startsWith('ar') ? st.ar : st.en);

  return (
    <View style={{ flex: 1 }}>
      {customSupported?<Pressable onPress={()=>void createSticker()} disabled={busy || libraryError} accessibilityRole="button" accessibilityLabel={t('stickers.create')}
        style={[s.createBtn,{opacity:busy || libraryError?0.5:1}]}>
        {busy?<ActivityIndicator color={colors.action.primary}/>:<Text style={{color:colors.action.primary,fontWeight:'700'}}>＋ {t('stickers.create')}</Text>}
      </Pressable>:<Text style={s.localHint}>{t('stickers.mobileOnly')}</Text>}
      {libraryError?<Pressable accessibilityRole="button" onPress={()=>{
        void loadCustomStickers(uid).then(value=>{setCustom(value);setLibraryError(false);}).catch(()=>Alert.alert(t('stickers.loadError')));
      }}><Text style={s.header}>{t('stickers.loadError')} · {t('stickers.retryImage')}</Text></Pressable>:null}
      {customSupported && !custom.length && !libraryError?<Text style={s.localHint}>{t('stickers.localHint')}</Text>:null}
      <FlatList
        data={rows}
        keyExtractor={r => r.key}
        initialNumToRender={6}
        windowSize={5}
        renderItem={({ item }) => item.header ? (
          <Text style={s.header}>{item.header}</Text>
        ) : item.custom ? <View style={{flexDirection:'row',paddingHorizontal:8}}>{item.custom.map(sticker=><Pressable
          key={`${sticker.id}/${sticker.revision}`} onPress={()=>sendCustom(sticker)} onLongPress={()=>setCustomPreview(sticker)} delayLongPress={250}
          accessibilityRole="button" accessibilityLabel={sticker.name || t('stickers.customSticker')} accessibilityHint={t('stickers.manageHint')}
          style={{width:cell,height:cell,padding:8}}>
          <Image source={{uri:customStickerUri(uid,sticker)}} style={{width:'100%',height:'100%'}} resizeMode="contain"/>
        </Pressable>)}</View> : (
          <StickerRow cells={item.cells!} size={cell} onSend={send} onPreview={setPreview} label={name} />
        )}
      />
      <Modal visible={!!customPreview || !!editor} transparent animationType="fade" onRequestClose={()=>{if(editor)editorRef.current?.requestClose();else setCustomPreview(null);}}>
        {editor?<StickerEditor ref={editorRef} embedded uid={uid} source={editor.source} previous={editor.previous} onClose={()=>setEditor(null)}
          onSaved={list=>{setCustom(list);setEditor(null);}}/>:
        <Pressable style={s.backdrop} onPress={()=>setCustomPreview(null)}>{customPreview?<Pressable style={s.previewCard} onPress={event=>event.stopPropagation()}>
          <Image source={{uri:customStickerUri(uid,customPreview)}} style={s.previewImg}/>
          <Text style={s.previewName}>{customPreview.name || t('stickers.customSticker')}</Text>
          <View style={{flexDirection:'row',gap:12}}>
            <Pressable onPress={()=>editCustom(customPreview)} accessibilityRole="button"><Text style={s.actionText}>{t('stickers.edit')}</Text></Pressable>
            <Pressable onPress={()=>removeCustom(customPreview)} accessibilityRole="button"><Text style={[s.actionText,{color:'#D84343'}]}>{t('common.delete')}</Text></Pressable>
          </View>
          <Pressable style={s.sendBtn} onPress={()=>sendCustom(customPreview)} accessibilityRole="button"><Text style={s.sendText}>{t('common.send')}</Text></Pressable>
        </Pressable>:null}</Pressable>}
      </Modal>
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={s.backdrop} onPress={() => setPreview(null)}>
          {preview ? (
            <View style={s.previewCard}>
              <Image source={STICKER_SOURCES[preview.packId]?.[preview.id]} style={s.previewImg} />
              <Text style={s.previewName}>{name(preview)}</Text>
              <Pressable style={s.sendBtn} onPress={() => send(preview)} accessibilityRole="button" accessibilityLabel={t('common.send')}>
                <Text style={s.sendText}>{t('common.send')}</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const StickerRow = memo(function StickerRow({ cells, size, onSend, onPreview, label }: {
  cells: Array<StickerDef & { packId: string }>; size: number;
  onSend: (s: StickerDef & { packId: string }) => void;
  onPreview: (s: StickerDef & { packId: string }) => void;
  label: (s: StickerDef) => string;
}) {
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
      {cells.map(st => (
        <Pressable
          key={`${st.packId}/${st.id}`}
          style={{ width: size, height: size, padding: 8 }}
          onPress={() => onSend(st)}
          onLongPress={() => onPreview(st)}
          delayLongPress={250}
          accessibilityRole="button"
          accessibilityLabel={label(st)}
          accessibilityHint="Long-press to preview"
        >
          <Image source={STICKER_SOURCES[st.packId]?.[st.id]} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        </Pressable>
      ))}
    </View>
  );
});

function styles(colors: any) {
  return StyleSheet.create({
    header:      { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, fontSize: 12, fontWeight: '700', color: colors.text.muted, textAlign: isRTL ? 'right' : 'left' },
    backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    previewCard: { backgroundColor: colors.background.surface, borderRadius: 20, padding: 20, alignItems: 'center', gap: 10 },
    previewImg:  { width: 200, height: 200 },
    previewName: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    sendBtn:     { backgroundColor: colors.action.primary, borderRadius: 20, paddingHorizontal: 28, paddingVertical: 10 },
    sendText:    { color: colors.action.primaryFg, fontWeight: '700' },
    createBtn:   {alignItems:'center',paddingVertical:10},
    localHint:   {fontSize:11,color:colors.text.muted,textAlign:'center',paddingHorizontal:16,paddingBottom:6},
    actionText:  {fontWeight:'600',color:colors.action.primary,padding:10},
  });
}
