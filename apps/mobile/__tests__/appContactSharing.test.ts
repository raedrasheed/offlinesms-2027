import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mocks = vi.hoisted(() => ({ load: vi.fn(), alert: vi.fn(), nativePicker: vi.fn(), permission: vi.fn() }));
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
vi.mock('../src/lib/appContacts', () => ({loadAppContacts:mocks.load,mergeAppContacts:(_:unknown,rows:unknown)=>rows}));
vi.mock('../src/lib/userProfiles', () => ({useDisplayName:(_:string,options:{snapshot:string})=>options.snapshot}));

import { AttachmentComposer } from '../src/components/chat/AttachmentComposer';
import { AppContactPicker } from '../src/components/chat/AppContactPicker';
import { AppContactCard } from '../src/components/chat/AppContactCard';
import { selectAttachment } from '../src/media/selectAttachment';

let renderer: ReactTestRenderer;
const contact={uid:'target-user',name:'رائد',username:'raed',phones:[],emails:[]};
const page={parts:[],hasMore:false};
const nodes=(type:string)=>renderer.root.findAll(node=>String(node.type)===type);
const sendButton=()=>nodes('Pressable').find(node=>node.props.children?.props?.children==='attachments.send')!;
beforeEach(()=>{
  vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  mocks.load.mockResolvedValue({contacts:[contact],page});
});
afterEach(async()=>{
  if(renderer) await act(async()=>renderer.unmount());
  vi.useRealTimers();vi.unstubAllGlobals();
});

describe('in-app contact sharing',()=>{
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
