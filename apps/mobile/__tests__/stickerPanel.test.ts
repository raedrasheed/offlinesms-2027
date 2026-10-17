import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mock=vi.hoisted(()=>({load:vi.fn(),pick:vi.fn(),remove:vi.fn(),removeTemp:vi.fn(),alert:vi.fn()}));
vi.mock('react-native',async()=>{const {createElement:h}=await import('react');return {View:'View',Text:'Text',Image:'Image',Pressable:'Pressable',Modal:'Modal',ActivityIndicator:'ActivityIndicator',Alert:{alert:mock.alert},
  FlatList:({data,renderItem}:any)=>h('FlatList',{},data.map((item:any)=>h('Row',{key:item.key},renderItem({item})))),Platform:{OS:'android'},StyleSheet:{create:(v:any)=>v},useWindowDimensions:()=>({width:400,height:800})};});
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(k:string)=>k,i18n:{language:'ar'}})}));
vi.mock('../src/context/ThemeContext',()=>({useTheme:()=>({colors:{action:{primary:'#00897B',primaryFg:'#FFFFFF'},text:{primary:'#111',muted:'#777'},background:{surface:'#FFF',subtle:'#EEE'},border:{subtle:'#DDD'}}})}));
vi.mock('../src/i18n',()=>({isRTL:true}));
vi.mock('../src/lib/recents',()=>({createRecentStore:()=>({load:async()=>[],add:async()=>[]})}));
vi.mock('../src/lib/customStickers',()=>({loadCustomStickers:mock.load,deleteCustomSticker:mock.remove,customStickerUri:(uid:string,s:any,source=false)=>`file:///${uid}/${s.id}-${s.revision}${source?'-source':''}.png`}));
vi.mock('../src/media/stickerImage',()=>({pickStickerImage:mock.pick,removeStickerTemp:mock.removeTemp}));
vi.mock('../src/components/chat/stickerSources',()=>({STICKER_SOURCES:{simsim:{hi:1}}}));
vi.mock('../src/components/chat/StickerEditor',()=>({StickerEditor:'Editor'}));
import {StickerPanel} from '../src/components/chat/StickerPanel';
let renderer:ReactTestRenderer|undefined;
const saved={id:'own',revision:'one',name:'My photo',sourceWidth:800,sourceHeight:400,sizeBytes:1000,edits:{text:'مرحبا'}};
const nodes=(type:string)=>renderer!.root.findAll(n=>String(n.type)===type);
const createButton=()=>nodes('Pressable').find(n=>n.props.accessibilityLabel==='stickers.create')!;
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mock.load.mockResolvedValue([]);mock.pick.mockResolvedValue({uri:'file:///picked.png',width:800,height:400});mock.remove.mockResolvedValue([]);mock.removeTemp.mockResolvedValue(undefined);});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals();});
describe('personal sticker picker',()=>{
  it('imports and saves without sending, then sends the saved sticker on an explicit tap',async()=>{
    const send=vi.fn();await act(async()=>{renderer=create(createElement(StickerPanel,{uid:'me',onSend:send}));});
    await act(async()=>createButton().props.onPress());expect(nodes('Editor')).toHaveLength(1);
    await act(async()=>nodes('Editor')[0].props.onSaved([saved]));expect(send).not.toHaveBeenCalled();expect(mock.removeTemp).toHaveBeenCalledWith('file:///picked.png');
    await act(async()=>nodes('Pressable').find(n=>n.props.accessibilityLabel==='My photo')!.props.onPress());
    expect(send).toHaveBeenCalledWith({custom:saved,uri:'file:///me/own-one.png'});
  });
  it('retains bundled stickers and opens a saved original for re-editing',async()=>{
    mock.load.mockResolvedValue([saved]);const send=vi.fn();await act(async()=>{renderer=create(createElement(StickerPanel,{uid:'me',onSend:send}));});
    await act(async()=>nodes('Pressable').find(n=>n.props.accessibilityLabel==='مرحبا')!.props.onPress());
    expect(send).toHaveBeenCalledWith({packId:'simsim',stickerId:'hi',alt:'👋'});
    await act(async()=>nodes('Pressable').find(n=>n.props.accessibilityLabel==='My photo')!.props.onLongPress());
    const editText=nodes('Text').find(n=>n.children.join('')==='stickers.edit')!;
    await act(async()=>editText.parent!.props.onPress());
    expect(nodes('Editor')[0].props).toMatchObject({previous:saved,source:{uri:'file:///me/own-one-source.png',width:800,height:400}});
  });
  it('cancels the system picker without creating a sticker or sending anything',async()=>{
    mock.pick.mockResolvedValue(null);const send=vi.fn();await act(async()=>{renderer=create(createElement(StickerPanel,{uid:'me',onSend:send}));});
    await act(async()=>createButton().props.onPress());expect(nodes('Editor')).toHaveLength(0);expect(send).not.toHaveBeenCalled();
  });
  it('keeps editing and bundled sends available while personal sending is unavailable',async()=>{
    mock.load.mockResolvedValue([saved]);const send=vi.fn();
    await act(async()=>{renderer=create(createElement(StickerPanel,{uid:'me',onSend:send,customSendingAvailable:false}));});
    expect(nodes('Text').some(n=>n.children.join('')==='stickers.sendingUnavailable')).toBe(true);
    await act(async()=>nodes('Pressable').find(n=>n.props.accessibilityLabel==='My photo')!.props.onPress());
    expect(send).not.toHaveBeenCalled();
    const sendButton=nodes('Text').find(n=>n.children.join('')==='common.send')!.parent!;
    expect(sendButton.props.disabled).toBe(true);
    await act(async()=>sendButton.props.onPress());expect(send).not.toHaveBeenCalled();
    await act(async()=>nodes('Text').find(n=>n.children.join('')==='stickers.edit')!.parent!.props.onPress());
    expect(nodes('Editor')[0].props.previous).toEqual(saved);
    await act(async()=>nodes('Editor')[0].props.onClose());
    await act(async()=>nodes('Pressable').find(n=>n.props.accessibilityLabel==='مرحبا')!.props.onPress());
    expect(send).toHaveBeenCalledWith({packId:'simsim',stickerId:'hi',alt:'👋'});
    send.mockClear();
    await act(async()=>renderer!.update(createElement(StickerPanel,{uid:'me',onSend:send,customSendingAvailable:true})));
    await act(async()=>nodes('Pressable').find(n=>n.props.accessibilityLabel==='My photo')!.props.onPress());
    expect(send).toHaveBeenCalledWith({custom:saved,uri:'file:///me/own-one.png'});
  });
  it('coalesces repeated import presses and cleans a late import when the account panel unmounts',async()=>{
    let resolve!:(v:any)=>void;mock.pick.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    await act(async()=>{renderer=create(createElement(StickerPanel,{uid:'me',onSend:vi.fn()}));});
    await act(async()=>{void createButton().props.onPress();void createButton().props.onPress();});expect(mock.pick).toHaveBeenCalledOnce();
    await act(async()=>renderer!.unmount());renderer=undefined;
    await act(async()=>resolve({uri:'file:///late.png',width:100,height:100}));expect(mock.removeTemp).toHaveBeenCalledWith('file:///late.png');
  });
});
