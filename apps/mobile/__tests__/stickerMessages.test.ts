import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { Message } from '../src/lib/conversations';
const mocks = vi.hoisted(() => ({
  window: { width: 390, height: 844 }, cache: vi.fn(), alert: vi.fn(), share: vi.fn(), sharingAvailable: vi.fn(),
  retryDownload: vi.fn(),
}));
vi.mock('react-native', () => ({
  View:'View',Text:'Text',Image:'Image',Pressable:'Pressable',Modal:'Modal',TextInput:'TextInput',
  ScrollView:'ScrollView',KeyboardAvoidingView:'KeyboardAvoidingView',ActivityIndicator:'ActivityIndicator',
  Platform:{OS:'android'},Linking:{},Clipboard:{},Alert:{alert:mocks.alert},
  StyleSheet:{create:(value:unknown)=>value,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}},
  useWindowDimensions:()=>mocks.window,
  AppState:{currentState:'active',addEventListener:()=>({remove:()=>{}})},
}));
vi.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
vi.mock('expo-av',()=>({Video:'Video',ResizeMode:{CONTAIN:'contain'}}));
vi.mock('expo-image',()=>({Image:'ExpoImage'}));
vi.mock('expo-sharing',()=>({isAvailableAsync:mocks.sharingAvailable,shareAsync:mocks.share}));
vi.mock('expo-location',()=>({}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('react-native-svg',()=>({default:'Svg',Circle:'Circle'}));
vi.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:24,bottom:20,left:0,right:0})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('../src/i18n',()=>({isRTL:false}));
vi.mock('../src/hooks/useTransfer',()=>({useTransfer:()=>undefined}));
vi.mock('../src/hooks/useCachedMediaUri',()=>({useCachedMediaUri:(m:Message)=>m.media?.localUri ?? m.media?.thumbnailURL ?? null}));
vi.mock('../src/hooks/useChatVideoThumbnail',()=>({useChatVideoThumbnail:(m:Message)=>m.media?.thumbnailURL ?? null}));
vi.mock('../src/media/mediaCache',()=>({ensureCached:mocks.cache,retryDownload:mocks.retryDownload}));
vi.mock('../src/lib/firebase',()=>({auth:{currentUser:{uid:'me'}}}));
vi.mock('../src/lib/saveMessageSticker',()=>({saveMessageSticker:vi.fn()}));
vi.mock('../src/context/ThemeContext',()=>({useTheme:()=>({colors:{background:{surface:'#fff'},border:{subtle:'#ddd'},action:{primary:'#123'}}})}));
vi.mock('../src/lib/userProfiles',()=>({useDisplayNames:()=>()=> 'Sender'}));
vi.mock('../src/lib/conversations',()=>({REACTION_EMOJIS:[]}));
vi.mock('../src/localdb',()=>({}));
vi.mock('../src/lib/emoji3d',()=>({matchAnimatedEmoji:()=>null}));
vi.mock('../src/components/LinkText',()=>({LinkText:'LinkText'}));
vi.mock('../src/components/MentionText',()=>({MentionText:'MentionText'}));
vi.mock('../src/components/ChatActionSheet',()=>({ChatActionSheet:'ChatActionSheet'}));
vi.mock('../src/components/ReactionsSheet',()=>({ReactionsSheet:'ReactionsSheet'}));
vi.mock('../src/components/chat/EmojiReactionPicker',()=>({EmojiReactionPicker:'EmojiReactionPicker'}));
vi.mock('../src/components/chat/ClipMessageBubble',()=>({ClipMessageBubble:'ClipMessageBubble'}));
vi.mock('../src/components/chat/AttachmentMessageBubble',()=>({AttachmentMessageBubble:'AttachmentMessageBubble'}));
vi.mock('../src/components/chat/VoiceMessageBubble',()=>({VoiceMessageBubble:'VoiceMessageBubble'}));
vi.mock('../src/components/chat/AnimatedEmoji3D',()=>({AnimatedEmoji3D:'AnimatedEmoji3D'}));
vi.mock('../src/components/chat/StickerBubble',()=>({StickerBubble:'StickerBubble',STICKER_SIZE:148}));
vi.mock('../src/components/chat/PollBubble',()=>({PollBubble:'PollBubble'}));
vi.mock('../src/components/chat/AppContactPicker',()=>({AppContactPicker:'AppContactPicker'}));


vi.mock('../src/theme',()=>({colors:{ink:'#111',ink100:'#eee',ink200:'#ddd',err:'#f00'}}));
vi.mock('../src/lib/avatar',()=>({avatarColor:()=> '#123',initials:()=> 'S'}));
vi.mock('../src/components/chat/ImageMessageBubble',()=>({ImageMessageBubble:'Photo'}));
vi.mock('../src/components/chat/VideoMessageBubble',()=>({VideoMessageBubble:'Video'}));
vi.mock('../src/components/chat/MediaUploadProgress',()=>({MediaUploadProgress:'Progress'}));
vi.mock('../src/components/chat/MessageReceipt',()=>({MessageReceipt:'Receipt'}));
vi.mock('../src/components/chat/attachmentCardStyles',()=>({ATTACHMENT_SENT:'#EFFDDE'}));
import { MessageBubble } from '../src/components/MessageBubble';
let renderer: ReactTestRenderer | undefined;
const flatten = (node:ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(Infinity));
const sticker:any = {id:'sticker',conversationId:'chat',senderUid:'peer',type:'image',text:'Sticker',createdAt:{toMillis:()=>1},
  media:{presentation:'sticker',mimeType:'image/png',sizeBytes:1200,width:512,height:512,localUri:'file:///sticker.png',uploadStatus:'uploaded'}};
const props = (message:any=sticker, extra:any={}) => ({ message, context:{conversationId:'chat',isGroup:true,isMyMessage:false,myRoleIsAdmin:false,isStarred:false,isPinned:false,myUid:'me'},
  showSender:true,onReply:vi.fn(),onEditStart:vi.fn(),onForward:vi.fn(),onJumpTo:vi.fn(),onInfo:vi.fn(),...extra });
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
afterEach(async()=>{if(renderer)await act(async()=>{renderer!.unmount();});renderer=undefined;vi.unstubAllGlobals();});
async function mount(message=sticker,extra:any={}){await act(async()=>{renderer=create(createElement(MessageBubble,props(message,extra)));});}
const surface=()=>renderer!.root.findByProps({testID:'message-surface'});
describe('stickers without a message card',()=>{
  it('never resurrects a deleted sticker in a pending row',async()=>{
    await mount({...sticker,type:'sticker',deletedForEveryone:true,sticker:{packId:'simsim',stickerId:'hi',alt:'Hi'}},{pending:'queued'});
    expect(renderer!.root.findAllByType('StickerBubble' as any)).toHaveLength(0);
    expect(renderer!.root.findAllByProps({testID:'custom-sticker-bubble'})).toHaveLength(0);
    expect(renderer!.root.findAllByType('Text' as any).some(node=>node.children.includes('This message was deleted.'))).toBe(true);
  });
  it('floats a received PNG above the wallpaper with a sender and time, while keeping its original PNG URI',async()=>{
    await mount();
    expect(flatten(surface())).toMatchObject({backgroundColor:'transparent',borderWidth:0,shadowOpacity:0,elevation:0});
    const root=renderer!.root.findByProps({testID:'custom-sticker-bubble'});
    expect(flatten(root).backgroundColor).toBe('transparent');
    const image=renderer!.root.findAllByType('Image' as any).find(node=>node.props.source?.uri==='file:///sticker.png')!;
    expect(flatten(image).backgroundColor).toBe('transparent');
    expect(renderer!.root.findAllByType('Text' as any).some(node=>node.children.includes('Sender'))).toBe(true);
    expect(renderer!.root.findAllByType('Text' as any).some(node=>node.children.some(value=>typeof value==='string'&&/\d\d:\d\d/.test(value)))).toBe(true);
  });
  it('uses the same sticker surface for legacy PNG messages and keeps normal images framed',async()=>{
    await mount({...sticker,media:{...sticker.media,presentation:null,fileName:'sticker-1234.png'},text:'Photo: sticker-1234.png'});
    expect(flatten(surface()).backgroundColor).toBe('transparent');
    expect(renderer!.root.findAllByProps({testID:'custom-sticker-bubble'})).toHaveLength(1);
    await act(async()=>{renderer!.update(createElement(MessageBubble,props({...sticker,text:'Photo',media:{...sticker.media,presentation:null,fileName:'photo.png'}})));});
    expect(flatten(surface()).backgroundColor).not.toBe('transparent');
    expect(renderer!.root.findAllByType('Photo' as any)).toHaveLength(1);
  });
  it('keeps bundled stickers transparent through queued, failed and delivered states without changing hook order',async()=>{
    const message={...sticker,type:'sticker',sticker:{packId:'simsim',stickerId:'hi',alt:'Hi'},media:null};
    const own={...props(message).context,isMyMessage:true};
    await mount(message,{pending:'queued',context:own});
    expect(flatten(surface()).backgroundColor).toBe('transparent');
    await act(async()=>{renderer!.update(createElement(MessageBubble,props(message,{context:own})));});
    expect(flatten(surface()).backgroundColor).toBe('transparent');
    await act(async()=>{renderer!.update(createElement(MessageBubble,props(message,{pending:'failed',context:own})));});
    expect(flatten(surface()).backgroundColor).toBe('transparent');
  });
});
