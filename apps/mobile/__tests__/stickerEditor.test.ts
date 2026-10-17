import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mock=vi.hoisted(()=>({capture:vi.fn(),release:vi.fn(),save:vi.fn(),orient:vi.fn(),remove:vi.fn(),alert:vi.fn()}));
vi.mock('react-native',()=>({View:'View',Text:'Text',TextInput:'TextInput',Image:'Image',Pressable:'Pressable',Modal:'Modal',ActivityIndicator:'ActivityIndicator',ScrollView:'ScrollView',KeyboardAvoidingView:'KeyboardAvoidingView',
  Keyboard:{dismiss:vi.fn()},Alert:{alert:mock.alert},Platform:{OS:'android'},PanResponder:{create:(handlers:any)=>({panHandlers:handlers})},StyleSheet:{create:(v:any)=>v,absoluteFill:{}},useWindowDimensions:()=>({width:400,height:800})}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(k:string)=>k})}));
vi.mock('../src/context/ThemeContext',()=>({useTheme:()=>({colors:{action:{primary:'#00897B',primaryFg:'#FFFFFF'},text:{primary:'#111',muted:'#777'},background:{surface:'#FFF',subtle:'#EEE'},border:{subtle:'#DDD'}}})}));
vi.mock('react-native-view-shot',()=>({captureRef:mock.capture,releaseCapture:mock.release}));
vi.mock('../src/lib/customStickers',()=>({saveCustomSticker:mock.save}));
vi.mock('../src/media/stickerImage',()=>({orientStickerImage:mock.orient,removeStickerTemp:mock.remove}));
import {StickerEditor} from '../src/components/chat/StickerEditor';
let renderer:ReactTestRenderer|undefined;
const source={uri:'file:///original.png',width:800,height:400};
const nodes=(type:string)=>renderer!.root.findAll(n=>String(n.type)===type);
const button=(label:string)=>nodes('Pressable').find(n=>n.props.accessibilityLabel===label)!;
async function loaded(){await act(async()=>{nodes('View').find(n=>n.props.testID==='sticker-capture')!.props.onLayout();nodes('Image')[0].props.onLoad();});}
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',(f:()=>void)=>{f();return 0;});
  mock.capture.mockResolvedValue('file:///captured.png');mock.save.mockResolvedValue([{id:'saved'}]);mock.orient.mockImplementation(async(s:any)=>s);mock.remove.mockResolvedValue(undefined);
});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals();});
describe('sticker editor',()=>{
  it('waits for image/layout, captures only the canvas and saves a reversible recipe with the original',async()=>{
    const saved=vi.fn();await act(async()=>{renderer=create(createElement(StickerEditor,{uid:'me',source,onClose:vi.fn(),onSaved:saved}));});
    expect(button('common.save').props.disabled).toBe(true);await loaded();
    await act(async()=>{nodes('TextInput')[0].props.onChangeText('مرحبا');button('stickers.circle').props.onPress();});
    await act(async()=>button('common.save').props.onPress());
    expect(mock.capture.mock.calls[0][1]).toMatchObject({width:512,height:512,format:'png',result:'tmpfile'});
    expect(mock.save).toHaveBeenCalledWith('me',expect.objectContaining({sourceUri:source.uri,imageUri:'file:///captured.png',sourceWidth:800,sourceHeight:400,edits:expect.objectContaining({text:'مرحبا',shape:'circle'})}));
    expect(saved).toHaveBeenCalledWith([{id:'saved'}]);expect(mock.release).toHaveBeenCalledWith('file:///captured.png');
  });
  it('blocks capture during rotation and allows undo after the newly oriented image loads',async()=>{
    await act(async()=>{renderer=create(createElement(StickerEditor,{uid:'me',source,onClose:vi.fn(),onSaved:vi.fn()}));});await loaded();
    let resolve!:(v:any)=>void;mock.orient.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    await act(async()=>button('stickers.rotate').props.onPress());expect(button('common.save').props.disabled).toBe(true);
    await act(async()=>resolve({uri:'file:///rotated.png',width:400,height:800}));expect(button('common.save').props.disabled).toBe(true);await loaded();
    await act(async()=>button('stickers.undo').props.onPress());
    expect(mock.orient.mock.calls.at(-1)?.[1].rotation).toBe(0);
  });
  it('retains edits and re-enables saving after a storage error, without sending',async()=>{
    const saved=vi.fn();mock.save.mockRejectedValueOnce(Error('disk-full'));
    await act(async()=>{renderer=create(createElement(StickerEditor,{uid:'me',source,onClose:vi.fn(),onSaved:saved}));});await loaded();
    await act(async()=>nodes('TextInput')[0].props.onChangeText('Keep this'));
    await act(async()=>button('common.save').props.onPress());expect(saved).not.toHaveBeenCalled();expect(mock.alert).toHaveBeenCalled();
    expect(nodes('TextInput')[0].props.value).toBe('Keep this');expect(button('common.save').props.disabled).toBe(false);
  });
  it('asks before discarding edits and never persists a cancelled editor',async()=>{
    const close=vi.fn();await act(async()=>{renderer=create(createElement(StickerEditor,{uid:'me',source,onClose:close,onSaved:vi.fn()}));});
    await act(async()=>button('stickers.crop').props.onPress());await act(async()=>button('common.cancel').props.onPress());
    expect(close).not.toHaveBeenCalled();expect(mock.save).not.toHaveBeenCalled();
    await act(async()=>mock.alert.mock.calls.at(-1)![2][1].onPress());expect(close).toHaveBeenCalledOnce();
  });
});
