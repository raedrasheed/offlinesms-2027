import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme';
import { avatarColor, initials } from '../../lib/avatar';
import { loadAppContacts, mergeAppContacts, type AppContact, type ContactPage } from '../../lib/appContacts';

/** A bounded, paginated account picker. Selection is a draft, never a send. */
export function AppContactPicker({ onPick }: { onPick: (contact: AppContact) => void }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<AppContact[]>([]);
  const [page, setPage] = useState<ContactPage>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const loading = useRef(false);

  useEffect(() => {
    const version = ++generation.current;
    setRows([]); setPage(undefined); setError(false); setBusy(true); loading.current = true;
    const timer = setTimeout(() => {
      void loadAppContacts(term).then(result => {
        if (version !== generation.current) return;
        setRows(mergeAppContacts([], result.contacts)); setPage(result.page);
      }).catch(() => { if (version === generation.current) setError(true); }).finally(() => {
        if (version === generation.current) { setBusy(false); loading.current = false; }
      });
    }, 200);
    return () => { clearTimeout(timer); generation.current++; };
  }, [term, retry]);

  async function more() {
    if (loading.current || !page?.hasMore) return;
    const version = generation.current;
    loading.current = true; setBusy(true); setError(false);
    try {
      const result = await loadAppContacts(term, page);
      if (version !== generation.current) return;
      setRows(old => mergeAppContacts(old, result.contacts)); setPage(result.page);
    } catch { if (version === generation.current) setError(true); }
    finally { if (version === generation.current) { setBusy(false); loading.current = false; } }
  }

  return <View style={s.root}>
    <Text style={s.hint}>{t('attachments.chooseAppContact')}</Text>
    <TextInput value={term} onChangeText={setTerm} maxLength={80} style={s.search}
      placeholder={t('attachments.searchAppContacts')} accessibilityLabel={t('attachments.searchAppContacts')}
      placeholderTextColor={colors.ink500} autoCapitalize="none" autoCorrect={false}/>
    <FlatList data={rows} keyExtractor={item => item.uid} keyboardShouldPersistTaps="handled"
      renderItem={({item}) => <Pressable style={s.row} onPress={() => onPick(item)} accessibilityRole="button" accessibilityLabel={item.name}>
        <View style={[s.avatar, {backgroundColor:avatarColor(item.uid)}]}><Text style={s.initials}>{initials(item.name)}</Text></View>
        <View style={s.details}><Text style={s.name}>{item.name}</Text><Text style={s.hint}>{item.username ? `@${item.username}` : 'OfflineSMS'}</Text></View>
      </Pressable>}
      ListEmptyComponent={!busy && !error ? <Text style={s.hint}>{t('attachments.noAppContacts')}</Text> : null}
      ListFooterComponent={<View style={s.footer}>
        {busy ? <ActivityIndicator color={colors.primary}/> : null}
        {error ? <><Text style={s.hint}>{t('attachments.contactSearchError')}</Text><Pressable accessibilityRole="button" onPress={() => {if(page) void more(); else setRetry(n => n + 1);}}><Text style={s.action}>{t('common.retry')}</Text></Pressable></> :
          !busy && page?.hasMore ? <Pressable accessibilityRole="button" onPress={() => {void more();}}><Text style={s.action}>{t('attachments.moreContacts')}</Text></Pressable> : null}
      </View>}/>
  </View>;
}

const s = StyleSheet.create({
  root:{flex:1,padding:20,gap:12},hint:{fontSize:14,color:colors.ink500,textAlign:'auto'},
  search:{borderWidth:1,borderColor:colors.ink200,borderRadius:12,padding:13,color:colors.ink,fontSize:16,textAlign:'auto'},
  row:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:13},
  avatar:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center'},initials:{color:'#fff',fontWeight:'700'},
  details:{flex:1,gap:4},name:{fontSize:16,color:colors.ink,fontWeight:'700',textAlign:'auto'},
  footer:{paddingVertical:18,gap:12,alignItems:'center'},action:{padding:10,color:colors.primary,fontWeight:'700'},
});
