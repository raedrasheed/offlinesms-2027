import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mocks=vi.hoisted(()=>({getClip:vi.fn(),interact:vi.fn(),follow:vi.fn(),auth:{currentUser:{uid:'me'}}}));
vi.mock('react-native',()=>({ActivityIndicator:'ActivityIndicator',Alert:{alert:vi.fn()},Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:(s:any)=>s},useWindowDimensions:()=>({height:800})}));
vi.mock('@react-navigation/native',async()=>{const {useEffect}=await import('react');return {useFocusEffect:(cb:any)=>useEffect(cb,[cb])};});
vi.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0})}));
vi.mock('@react-native-community/netinfo',()=>({useNetInfo:()=>({type:'wifi'})}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('../src/lib/firebase',()=>({auth:mocks.auth}));
vi.mock('../src/lib/clips',()=>({getClip:mocks.getClip,setClipInteraction:mocks.interact,followClipCreator:mocks.follow}));
vi.mock('../src/lib/clipsCopy',()=>({useClipsCopy:()=>({c:(en:string)=>en})}));
vi.mock('../src/hooks/useClipPreferences',()=>({useClipPreferences:()=>({settings:{muted:true,dataSaving:'auto'},update:vi.fn()})}));
vi.mock('../src/hooks/useClipVisibility',()=>({useClipVisibility:()=>true}));
vi.mock('../src/components/clips/ClipCard',()=>({default:'ClipCard'}));
vi.mock('../src/components/clips/ClipCommentsSheet',()=>({default:'CommentsSheet'}));
vi.mock('../src/components/clips/ClipShareSheet',()=>({default:'ShareSheet'}));
vi.mock('../src/components/clips/ClipActionsSheet',()=>({default:'ActionsSheet'}));
import ClipViewer from '../src/screens/clips/ClipViewer';
let renderer:ReactTestRenderer|undefined;const props={route:{params:{clipId:'private',share:true}},navigation:{navigate:vi.fn(),goBack:vi.fn()}};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals();});
describe('forwarded clip access',()=>{
  it('does not replace a newly opened clip with a late like or comment response from the previous clip',async()=>{
    let finish!:(value:any)=>void;mocks.interact.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    mocks.getClip.mockImplementation(async id=>({id,status:'published',ownerUid:'author',likedByMe:false,commentCount:0}));
    await act(async()=>{renderer=create(createElement(ClipViewer,{...props,route:{params:{clipId:'a',share:false}}}));});
    const comments=renderer!.root.findByType('CommentsSheet' as any).props;
    await act(async()=>{void renderer!.root.findByType('ClipCard' as any).props.onLike();});
    await act(async()=>renderer!.update(createElement(ClipViewer,{...props,route:{params:{clipId:'b',share:false}}})));
    await act(async()=>{finish({likeCount:50});comments.onCountChange(12);});
    expect(renderer!.root.findByType('ClipCard' as any).props.clip).toMatchObject({id:'b',likedByMe:false,commentCount:0});
  });
  it('does not apply a late follow result after navigating to a different clip',async()=>{
    let finish!:(value:any)=>void;mocks.follow.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    mocks.getClip.mockImplementation(async id=>({id,status:'published',ownerUid:id+'-author',followStatus:'none'}));
    await act(async()=>{renderer=create(createElement(ClipViewer,{...props,route:{params:{clipId:'a',share:false}}}));});
    await act(async()=>{void renderer!.root.findByType('ClipCard' as any).props.onFollow();});
    await act(async()=>renderer!.update(createElement(ClipViewer,{...props,route:{params:{clipId:'b',share:false}}})));
    await act(async()=>finish({status:'accepted'}));expect(renderer!.root.findByType('ClipCard' as any).props.clip).toMatchObject({id:'b',followStatus:'none'});
  });

  it('waits for current authorization before opening the share panel and pauses the player',async()=>{
    let complete!:(value:any)=>void;mocks.getClip.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    await act(async()=>{renderer=create(createElement(ClipViewer,props));});expect(renderer!.root.findAllByType('ShareSheet' as any)).toHaveLength(0);
    await act(async()=>complete({id:'private',status:'published',ownerUid:'author'}));expect(renderer!.root.findByType('ShareSheet' as any).props.visible).toBe(true);expect(renderer!.root.findByType('ClipCard' as any).props.active).toBe(false);
    await act(async()=>renderer!.root.findByType('ShareSheet' as any).props.onClose());expect(renderer!.root.findByType('ClipCard' as any).props.active).toBe(true);
  });
  it('does not expose a share panel or playable card when access was revoked',async()=>{
    mocks.getClip.mockRejectedValue(new Error('permission-denied'));await act(async()=>{renderer=create(createElement(ClipViewer,props));});
    expect(renderer!.root.findAllByType('ShareSheet' as any)).toHaveLength(0);expect(renderer!.root.findAllByType('ClipCard' as any)).toHaveLength(0);
  });
  it('never automatically shares an owner preview still under review',async()=>{
    mocks.getClip.mockResolvedValue({id:'private',status:'pending_review',ownerUid:'me'});await act(async()=>{renderer=create(createElement(ClipViewer,props));});
    expect(renderer!.root.findByType('ShareSheet' as any).props.visible).toBe(false);
  });
});
