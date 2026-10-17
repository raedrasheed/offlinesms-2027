import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mocks = vi.hoisted(() => ({ load: vi.fn(), alert: vi.fn(), nativePicker: vi.fn(), permission: vi.fn(), openChat:vi.fn() }));
vi.mock('react-native', () => ({
  Modal:'Modal',View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable',FlatList:'FlatList',
  ScrollView:'ScrollView',KeyboardAvoidingView:'KeyboardAvoidingView',Image:'Image',ActivityIndicator:'ActivityIndicator',
  Alert:{alert:mocks.alert},Linking:{openSettings:vi.fn()},Platform:{OS:'android'},StyleSheet:{create:(v:unknown)=>v},
}));
vi.mock('@expo/vector-icons', () => ({Ionicons:'Icon'}));
vi.mock('expo-av', () => ({Video:'Video',ResizeMode:{CONTAIN:'contain'}}));
vi.mock('expo-location', () => ({}));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-contacts', () => ({presentContactPickerAsync:mocks.nativePicker,requestPermissionsAsync:mocks.permission}));
vi.mock('react-i18next', () => ({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('react-native-safe-area-context', () => ({useSafeAreaInsets:()=>({top:24,bottom:20})}));
vi.mock('../src/lib/appContacts', () => ({loadAppContacts:mocks.load,mergeAppContacts:(_:unknown,rows:unknown)=>rows,contactSearchErrorKey:()=> 'attachments.contactServiceUnavailable'}));
vi.mock('../src/lib/conversations',()=>({getOrCreateDirectConversation:mocks.openChat}));

import { AttachmentComposer } from '../src/components/chat/AttachmentComposer';
import { AppContactPicker } from '../src/components/chat/AppContactPicker';
import { AppContactCard } from '../src/components/chat/AppContactCard';
import { selectAttachment } from '../src/media/selectAttachment';
import NewChat from '../src/screens/NewChat';
import NewChatMenu from '../src/screens/NewChatMenu';

let renderer: ReactTestRenderer;
const contact={uid:'target-user',name:'رائد',username:'raed',phones:[],emails:[]};
const page={cursor:[],hasMore:false};
const nodes=(type:string)=>renderer.root.findAll(node=>String(node.type)===type);
const sendButton=()=>nodes('Pressable').find(node=>node.props.children?.props?.children==='attachments.send')!;
beforeEach(()=>{
  vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  mocks.load.mockResolvedValue({contacts:[contact],page});
  mocks.openChat.mockResolvedValue('direct-chat');
});
afterEach(async()=>{
  if(renderer) await act(async()=>renderer.unmount());
  vi.useRealTimers();vi.unstubAllGlobals();
});

describe('in-app contact sharing',()=>{
  it.each([NewChat,NewChatMenu])('shows account contacts before typing in %s and uses the same partial-name search',async Screen=>{
    const navigation={replace:vi.fn(),navigate:vi.fn(),goBack:vi.fn()};
    await act(async()=>{renderer=create(createElement(Screen,{navigation}));});
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    expect(mocks.load).toHaveBeenCalledWith('',undefined);expect(nodes('FlatList')[0].props.data).toEqual([contact]);
    await act(async()=>nodes('TextInput')[0].props.onChangeText('aE'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    expect(mocks.load).toHaveBeenLastCalledWith('aE',undefined);
    const row=nodes('FlatList')[0].props.renderItem({item:contact});
    await act(async()=>{row.props.onPress();row.props.onPress();});
    expect(mocks.openChat).toHaveBeenCalledOnce();expect(mocks.openChat).toHaveBeenCalledWith(contact.uid);
    expect(navigation.replace).toHaveBeenCalledWith('Conversation',{id:'direct-chat'});
  });
  it('continues past an empty page before deciding there are no contacts',async()=>{
    const partial={cursor:[{done:false,afterUid:'first'}],hasMore:true};
    mocks.load.mockResolvedValueOnce({contacts:[],page:partial});
    await act(async()=>{renderer=create(createElement(AppContactPicker,{onPick:vi.fn()}));});
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    expect(mocks.load).toHaveBeenCalledTimes(2);expect(mocks.load).toHaveBeenLastCalledWith('',partial);
    expect(nodes('FlatList')[0].props.data).toEqual([contact]);
  });
  it('shows an unavailable-service error with retry rather than a misleading empty result',async()=>{
    mocks.load.mockRejectedValueOnce({code:'functions/not-found'});
    await act(async()=>{renderer=create(createElement(AppContactPicker,{onPick:vi.fn()}));});
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    const list=nodes('FlatList')[0];expect(list.props.ListEmptyComponent).toBeNull();
    // Render the footer because the native FlatList host mock does not render its prop elements.
    let footer:ReactTestRenderer;
    await act(async()=>{footer=create(list.props.ListFooterComponent);});
    expect(JSON.stringify(footer!.toJSON())).toContain('attachments.contactServiceUnavailable');
    await act(async()=>footer!.root.findAll(n=>String(n.type)==='Pressable')[0].props.onPress());
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    expect(nodes('FlatList')[0].props.data).toEqual([contact]);
    await act(async()=>footer!.unmount());
  });
  it('selects an app account, previews it, and queues only after explicit Send',async()=>{
    const draft=await selectAttachment('contact');
    expect(draft).toEqual({kind:'contact'});
    const onSend=vi.fn().mockResolvedValue(undefined),onClose=vi.fn();
    await act(async()=>{renderer=create(createElement(AttachmentComposer,{draft:draft!,onSend,onClose}));});
    expect(sendButton().props.disabled).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    const list=nodes('FlatList')[0];
    expect(list.props.data).toEqual([contact]);
    await act(async()=>list.props.renderItem({item:contact}).props.onPress());
    expect(onSend).not.toHaveBeenCalled();
    expect(sendButton().props.disabled).toBe(false);
    expect(nodes('TextInput')).toHaveLength(0); // names/phones cannot be manually forged
    await act(async()=>sendButton().props.onPress());
    expect(onSend).toHaveBeenCalledWith({kind:'contact',contact});
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.nativePicker).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it('does not replace a newer search with a late response from the previous query',async()=>{
    let resolveOld!:(value:unknown)=>void;
    mocks.load.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
    await act(async()=>{renderer=create(createElement(AppContactPicker,{onPick:vi.fn()}));});
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    await act(async()=>nodes('TextInput')[0].props.onChangeText('@raed'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(200);});
    await act(async()=>resolveOld({contacts:[{...contact,uid:'stale',name:'Old'}],page}));
    expect(nodes('FlatList')[0].props.data).toEqual([contact]);
  });
  it('opens the shared uid once even when the card is tapped repeatedly',async()=>{
    let finish!:()=>void;
    const onOpen=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    await act(async()=>{renderer=create(createElement(AppContactCard,{contact,myUid:'me',onOpen}));});
    await act(async()=>{nodes('Pressable')[0].props.onPress();nodes('Pressable')[0].props.onPress();});
    expect(onOpen).toHaveBeenCalledOnce();expect(onOpen).toHaveBeenCalledWith('target-user');
    await act(async()=>finish());
  });
  it('handles an unavailable account and allows a later retry',async()=>{
    const onOpen=vi.fn().mockRejectedValue({code:'functions/not-found'});
    await act(async()=>{renderer=create(createElement(AppContactCard,{contact,myUid:'me',onOpen}));});
    await act(async()=>nodes('Pressable')[0].props.onPress());
    expect(mocks.alert).toHaveBeenCalledWith('attachments.contactOpenError','attachments.contactUnavailable');
    onOpen.mockResolvedValue(undefined);
    await act(async()=>nodes('Pressable')[0].props.onPress());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
  it('does not try to start a self-chat when the recipient receives their own card',async()=>{
    const onOpen=vi.fn();
    await act(async()=>{renderer=create(createElement(AppContactCard,{contact,myUid:contact.uid,onOpen}));});
    await act(async()=>nodes('Pressable')[0].props.onPress());
    expect(onOpen).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('attachments.yourContact');
  });
});
