import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {decodeMapTile} from '../src/media/vectorMap';
import {mapFixture} from './helpers/mapFixture';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mocks=vi.hoisted(()=>({tile:vi.fn(),link:vi.fn()}));
vi.mock('react-native',()=>({View:'View',Text:'Text',Pressable:'Pressable',Image:'Image',ActivityIndicator:'ActivityIndicator',Linking:{openURL:mocks.link},StyleSheet:{create:(v:any)=>v},useWindowDimensions:()=>({width:424,height:800})}));
vi.mock('react-native-svg',()=>({default:'Svg',Circle:'Circle',Defs:'Defs',LinearGradient:'LinearGradient',Path:'Path',Rect:'Rect',Stop:'Stop',Text:'SvgText',G:'G',ClipPath:'ClipPath'}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en'},t:(k:string)=>k})}));
vi.mock('../src/media/mapTileCache',()=>({cachedMapTile:mocks.tile}));
import {LocationMessageCard} from '../src/components/chat/LocationMessageCard';
import {FileMessageCard} from '../src/components/chat/FileMessageCard';
let renderer:ReactTestRenderer;
const nodes=(type:string)=>renderer.root.findAll(n=>String(n.type)===type);
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.tile.mockImplementation(async ()=>decodeMapTile(mapFixture()));mocks.link.mockResolvedValue(undefined);});
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());vi.unstubAllGlobals();});
describe('reference attachment cards',()=>{
  it('loads only after the location is visible, opens its exact coordinate and keeps attribution separate',async()=>{
    const onOpen=vi.fn(),location={latitude:31.5,longitude:34.46};
    await act(async()=>{renderer=create(createElement(LocationMessageCard,{location,visible:false,onOpen}));});
    expect(mocks.tile).not.toHaveBeenCalled();
    await act(async()=>renderer.update(createElement(LocationMessageCard,{location,visible:true,onOpen})));
    expect(nodes('Svg').some(n=>n.props.testID==='location-vector-map')).toBe(true);
    await act(async()=>nodes('Pressable')[0].props.onPress());
    expect(onOpen).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=31.5,34.46');
    const stopPropagation=vi.fn();
    await act(async()=>nodes('Pressable')[1].props.onPress({stopPropagation}));
    expect(stopPropagation).toHaveBeenCalledOnce();expect(mocks.link).toHaveBeenCalledWith('https://openfreemap.org/');
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it('uses an explicit unavailable preview when tiles cannot load and still opens maps',async()=>{
    mocks.tile.mockResolvedValue(null);const onOpen=vi.fn();
    await act(async()=>{renderer=create(createElement(LocationMessageCard,{location:{latitude:31.5,longitude:34.46},visible:true,onOpen}));});
    expect(nodes('Svg').some(n=>n.props.testID==='location-vector-map')).toBe(false);expect(JSON.stringify(renderer.toJSON())).toContain('attachments.mapPreviewUnavailable');
    await act(async()=>nodes('Pressable')[0].props.onPress());expect(onOpen).toHaveBeenCalledOnce();
  });
  it('retries an unavailable map without opening the external map',async()=>{
    mocks.tile.mockResolvedValue(null);const onOpen=vi.fn();
    await act(async()=>{renderer=create(createElement(LocationMessageCard,{location:{latitude:31.5,longitude:34.46},visible:true,onOpen}));});
    mocks.tile.mockImplementation(async()=>decodeMapTile(mapFixture()));
    const retry=nodes('Pressable').find(n=>n.props.accessibilityLabel==='attachments.retryMap')!;
    const stopPropagation=vi.fn();await act(async()=>retry.props.onPress({stopPropagation}));
    expect(stopPropagation).toHaveBeenCalledOnce();expect(onOpen).not.toHaveBeenCalled();
    expect(nodes('Svg').some(n=>n.props.testID==='location-vector-map')).toBe(true);
  });
  it('does not show tiles from a previous location while the next location loads',async()=>{
    const onOpen=vi.fn();
    await act(async()=>{renderer=create(createElement(LocationMessageCard,{location:{latitude:31.5,longitude:34.46},visible:true,onOpen}));});
    expect(nodes('Svg').some(n=>n.props.testID==='location-vector-map')).toBe(true);
    mocks.tile.mockImplementation(()=>new Promise<any>(()=>{}));
    await act(async()=>renderer.update(createElement(LocationMessageCard,{location:{latitude:32,longitude:35},visible:true,onOpen})));
    expect(nodes('Svg').some(n=>n.props.testID==='location-vector-map')).toBe(false);
  });
  it('keeps file downloads explicit and exposes pending/retry/open states',async()=>{
    const onPress=vi.fn();const props={message:{id:'file',type:'file',media:{fileName:'شهادة.doc',mimeType:'application/msword',sizeBytes:40960}} as any,mine:true,ready:true,busy:false,uploading:false,failed:false,cached:false,progress:0,onPress};
    await act(async()=>{renderer=create(createElement(FileMessageCard,props));});
    expect(onPress).not.toHaveBeenCalled();expect(nodes('Text').some(n=>n.children.join('')==='DOC · 40 kB')).toBe(true);
    expect(nodes('Icon')[0].props.name).toBe('download-outline');
    await act(async()=>nodes('Pressable')[0].props.onPress());expect(onPress).toHaveBeenCalledOnce();
    await act(async()=>renderer.update(createElement(FileMessageCard,{...props,uploading:true,ready:false,progress:40})));
    expect(nodes('Pressable')[0].props.disabled).toBe(true);expect(JSON.stringify(renderer.toJSON())).toContain('40');
    await act(async()=>renderer.update(createElement(FileMessageCard,{...props,failed:true,ready:false})));
    expect(nodes('Icon')[0].props.name).toBe('refresh');expect(nodes('Pressable')[0].props.disabled).toBe(false);
    await act(async()=>renderer.update(createElement(FileMessageCard,{...props,cached:true})));
    expect(nodes('Icon')[0].props.name).toBe('open-outline');
  });
});
