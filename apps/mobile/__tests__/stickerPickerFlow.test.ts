import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mock=vi.hoisted(()=>({load:vi.fn(),pick:vi.fn(),remove:vi.fn(),listener:null as null|((list:any[])=>void),unsubscribe:vi.fn()}));
vi.mock('react-native',()=>({View:'View',Text:'Text',Pressable:'Pressable',Image:'Image',Modal:'Modal',ActivityIndicator:'ActivityIndicator',
  Platform:{OS:'android'},Alert:{alert:vi.fn()},StyleSheet:{create:(value:any)=>value,hairlineWidth:1},useWindowDimensions:()=>({width:390,height:800}),
  FlatList:({data,renderItem}:any)=>createElement('Rows',{},data.map((item:any)=>createElement('Row',{key:item.key},renderItem({item})))),
}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key,i18n:{language:'en'}})}));
vi.mock('../src/i18n',()=>({isRTL:false}));
vi.mock('../src/context/ThemeContext',()=>({useTheme:()=>({colors:{background:{surface:'#fff',subtle:'#eee'},border:{subtle:'#ddd'},text:{primary:'#111',muted:'#555'},action:{primary:'#123',primaryFg:'#fff'}}})}));
vi.mock('../src/lib/stickers',()=>({STICKER_PACKS:[],findSticker:vi.fn(),stickerKey:vi.fn(),parseStickerKey:vi.fn()}));
vi.mock('../src/lib/recents',()=>({createRecentStore:()=>({load:async()=>[],add:async()=>[]})}));
vi.mock('../src/components/chat/stickerSources',()=>({STICKER_SOURCES:{}}));
vi.mock('../src/components/chat/EmojiPanel',()=>({EmojiPanel:'EmojiPicker'}));
vi.mock('../src/components/chat/StickerEditor',()=>({StickerEditor:'StickerEditor'}));
vi.mock('../src/media/stickerImage',()=>({pickStickerImage:mock.pick,removeStickerTemp:mock.remove}));
vi.mock('../src/lib/customStickers',()=>({loadCustomStickers:mock.load,deleteCustomSticker:vi.fn(),customStickerUri:(_uid:string,s:any)=>`file:///${s.id}.png`,
  subscribeCustomStickers:(_uid:string,listener:any)=>{mock.listener=listener;return mock.unsubscribe;}}));
import { ComposerPanel } from '../src/components/chat/ComposerPanel';
let renderer:ReactTestRenderer;
const props={uid:'me',height:300,bottomInset:20,onEmoji:vi.fn(),onSticker:vi.fn(),customSendingAvailable:true};
const button=(label:string)=>renderer.root.findAllByType('Pressable' as any).find(node=>node.props.accessibilityLabel===label)!;
const sticker={id:'saved-1',revision:'rev-1',name:'My new sticker',sourceWidth:512,sourceHeight:512};
beforeEach(()=>{vi.clearAllMocks();mock.listener=null;mock.load.mockResolvedValue([]);mock.pick.mockResolvedValue({uri:'file:///picked.png',width:512,height:512});mock.remove.mockResolvedValue(undefined);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());vi.unstubAllGlobals();});
describe('Emoji and sticker composer workflow',()=>{
  it('opens actual stickers from the emoji picker and keeps a created sticker ready to send',async()=>{
    await act(async()=>{renderer=create(createElement(ComposerPanel,props));});
    expect(renderer.root.findAllByType('EmojiPicker' as any)).toHaveLength(1);
    await act(async()=>button('composer.stickers').props.onPress());
    await act(async()=>button('stickers.create').props.onPress());
    const editor=renderer.root.findByType('StickerEditor' as any);
    expect(editor.props.source.uri).toBe('file:///picked.png');
    await act(async()=>editor.props.onSaved([sticker]));
    expect(renderer.root.findAllByType('StickerEditor' as any)).toHaveLength(0);
    await act(async()=>button('My new sticker').props.onPress());
    expect(props.onSticker).toHaveBeenCalledWith({custom:sticker,uri:'file:///saved-1.png'});
    expect(props.onEmoji).not.toHaveBeenCalled();
  });
  it('shows a sticker saved from a received message immediately and ignores an older initial library read',async()=>{
    let resolve!:(list:any[])=>void;
    mock.load.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    await act(async()=>{renderer=create(createElement(ComposerPanel,{...props,initialTab:'stickers'}));});
    await act(async()=>mock.listener!([sticker]));
    await act(async()=>resolve([]));
    expect(button('My new sticker')).toBeDefined();
    await act(async()=>button('My new sticker').props.onPress());
    expect(props.onSticker).toHaveBeenCalledWith({custom:sticker,uri:'file:///saved-1.png'});
    await act(async()=>renderer.unmount());
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
});
