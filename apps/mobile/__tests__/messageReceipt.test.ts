import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
vi.mock('react-native',()=>({View:'View',Text:'Text',StyleSheet:{create:(v:any)=>v}}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
import {MessageReceipt} from '../src/components/chat/MessageReceipt';
let renderer:ReactTestRenderer;
const icon=()=>renderer.root.findAll(n=>String(n.type)==='Icon')[0];
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());vi.unstubAllGlobals();});
describe('shared message checkmarks',()=>{
  it('updates sent, delivered and read checks with the file-card glyph, size and colors',async()=>{
    await act(async()=>{renderer=create(createElement(MessageReceipt,{message:{deliveredCount:0,readCount:0},isGroup:false}));});
    expect(icon().props).toMatchObject({name:'checkmark',size:15,color:'#8A9C92'});
    await act(async()=>renderer.update(createElement(MessageReceipt,{message:{deliveredCount:1,readCount:0},isGroup:false})));
    expect(icon().props).toMatchObject({name:'checkmark-done',size:15,color:'#8A9C92'});
    await act(async()=>renderer.update(createElement(MessageReceipt,{message:{deliveredCount:1,readCount:1},isGroup:false})));
    expect(icon().props).toMatchObject({name:'checkmark-done',size:15,color:'#34B7F1'});
  });
  it('keeps the same checkmarks on media overlays and in both group layouts',async()=>{
    const message={deliveredCount:6,readCount:3};
    await act(async()=>{renderer=create(createElement(MessageReceipt,{message,isGroup:false}));});
    for(const props of [{isGroup:false,overlay:true},{isGroup:true,memberCount:8},{isGroup:true,memberCount:30}]){
      await act(async()=>{if(renderer)renderer.update(createElement(MessageReceipt,{message,...props}));else renderer=create(createElement(MessageReceipt,{message,...props}));});
      expect(icon().props).toMatchObject({name:'checkmark-done',size:15,color:'#34B7F1'});
    }
  });
});
