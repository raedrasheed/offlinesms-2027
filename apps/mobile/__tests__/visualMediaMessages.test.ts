// Real media cards with native hosts mocked: ratio, message chrome and explicit playback lifecycle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { Message } from '../src/lib/conversations';

const mocks = vi.hoisted(() => ({
  window: { width: 390, height: 844 }, cache: vi.fn(), alert: vi.fn(), share: vi.fn(), sharingAvailable: vi.fn(),
}));
vi.mock('react-native', () => ({
  View:'View',Text:'Text',Image:'Image',Pressable:'Pressable',Modal:'Modal',TextInput:'TextInput',
  ScrollView:'ScrollView',KeyboardAvoidingView:'KeyboardAvoidingView',ActivityIndicator:'ActivityIndicator',
  Platform:{OS:'android'},Linking:{},Clipboard:{},Alert:{alert:mocks.alert},
  StyleSheet:{create:(value:unknown)=>value,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}},
  useWindowDimensions:()=>mocks.window,
}));
vi.mock('expo-av',()=>({Video:'Video',ResizeMode:{CONTAIN:'contain'}}));
vi.mock('expo-sharing',()=>({isAvailableAsync:mocks.sharingAvailable,shareAsync:mocks.share}));
vi.mock('expo-location',()=>({}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('react-native-svg',()=>({default:'Svg',Circle:'Circle'}));
vi.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:24,bottom:20,left:0,right:0})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('../src/hooks/useTransfer',()=>({useTransfer:()=>undefined}));
vi.mock('../src/hooks/useCachedMediaUri',()=>({useCachedMediaUri:(m:Message)=>m.media?.localUri ?? m.media?.thumbnailURL ?? null}));
vi.mock('../src/media/mediaCache',()=>({ensureCached:mocks.cache,retryDownload:vi.fn()}));
vi.mock('../src/lib/userProfiles',()=>({useDisplayNames:()=>()=> 'Sender'}));
vi.mock('../src/lib/conversations',()=>({REACTION_EMOJIS:[]}));
vi.mock('../src/localdb',()=>({}));
vi.mock('../src/lib/emoji3d',()=>({matchAnimatedEmoji:()=>null}));
vi.mock('../src/components/LinkText',()=>({LinkText:'LinkText'}));
vi.mock('../src/components/MentionText',()=>({MentionText:'MentionText'}));
vi.mock('../src/components/ChatActionSheet',()=>({ChatActionSheet:'ChatActionSheet'}));
vi.mock('../src/components/ReactionsSheet',()=>({ReactionsSheet:'ReactionsSheet'}));
vi.mock('../src/components/chat/EmojiReactionPicker',()=>({EmojiReactionPicker:'EmojiReactionPicker'}));
vi.mock('../src/components/chat/AttachmentMessageBubble',()=>({AttachmentMessageBubble:'AttachmentMessageBubble'}));
vi.mock('../src/components/chat/VoiceMessageBubble',()=>({VoiceMessageBubble:'VoiceMessageBubble'}));
vi.mock('../src/components/chat/AnimatedEmoji3D',()=>({AnimatedEmoji3D:'AnimatedEmoji3D'}));
vi.mock('../src/components/chat/StickerBubble',()=>({StickerBubble:'StickerBubble'}));
vi.mock('../src/components/chat/PollBubble',()=>({PollBubble:'PollBubble'}));
vi.mock('../src/components/chat/AppContactPicker',()=>({AppContactPicker:'AppContactPicker'}));

import { MessageBubble } from '../src/components/MessageBubble';
import { ImageMessageBubble } from '../src/components/chat/ImageMessageBubble';
import { VideoMessageBubble } from '../src/components/chat/VideoMessageBubble';
import { AttachmentComposer } from '../src/components/chat/AttachmentComposer';
import { fitMediaDimensions, validMediaDimensions, videoDisplayDimensions } from '../src/media/mediaDimensions';

let renderer: ReactTestRenderer;
const nodes = (type:string)=>renderer.root.findAll(node=>String(node.type)===type);
const style = (node:ReactTestInstance)=>Object.assign({},...[node.props.style].flat(Infinity));
const frame = ()=>nodes('Pressable').find(node=>node.props.accessibilityRole==='imagebutton')!;
const mediaBox = ()=>nodes('View').find(node=>node.props.testID==='media-content')!;
const button = (label:string)=>nodes('Pressable').find(node=>node.props.accessibilityLabel===label)!;
const message = (type:'image'|'video',extra:Partial<Message>={}):Message=>({
  id:'message-1',conversationId:'chat',senderUid:'me',type,text:'',createdAt:{toMillis:()=>1},
  media:{storagePath:'chat/file',downloadURL:'https://example.test/media',localUri:'file:///picked',
    mimeType:type==='video'?'video/mp4':'image/jpeg',sizeBytes:4000,uploadStatus:'uploaded',width:1920,height:1080},
  ...extra,
} as Message);
async function mountVideo(m=message('video'),props:Record<string,unknown>={}) {
  await act(async()=>{renderer=create(createElement(VideoMessageBubble,{message:m,mine:true,...props}));});
}
async function mountBubble(m:Message,mine=true) {
  await act(async()=>{renderer=create(createElement(MessageBubble,{
    message:m,context:{conversationId:'chat',isGroup:false,isMyMessage:mine,myRoleIsAdmin:false,isStarred:false,isPinned:false,myUid:'me'},
    showSender:false,onReply:vi.fn(),onEditStart:vi.fn(),onForward:vi.fn(),onJumpTo:vi.fn(),onInfo:vi.fn(),
  }));});
}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  mocks.window={width:390,height:844};mocks.cache.mockResolvedValue('file:///cached.mp4');
  mocks.sharingAvailable.mockResolvedValue(true);mocks.share.mockResolvedValue(undefined);
});
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());vi.unstubAllGlobals();});

describe('proportional photo and video messages',()=>{
  it.each([[1920,1080],[1080,1920],[800,800],[4000,500],[500,4000]])('preserves %s × %s in identical image/video frames',async(width,height)=>{
    const frames=[];
    for(const type of ['image','video'] as const){
      const m=message(type);m.media={...m.media!,width,height};
      await mountBubble(m);
      const box=style(mediaBox());frames.push(box);
      expect(box.width/box.height).toBeCloseTo(width/height,8);
      expect(box.width).toBeLessThanOrEqual(230);expect(box.height).toBeLessThanOrEqual(420);
      expect(nodes('AttachmentMessageBubble')).toHaveLength(0);
      expect(nodes('Video')).toHaveLength(0);
      expect(nodes('Image').every(node=>node.props.resizeMode==='contain')).toBe(true);
      await act(async()=>renderer.unmount());
    }
    expect(frames[0]).toEqual(frames[1]);
  });
  it.each([true,false])('uses the same card, caption and receipt placement (mine=%s)',async mine=>{
    for(const caption of ['', 'تعليق على المرفق']){
      const renders=[];
      for(const type of ['image','video'] as const){
        await mountBubble(message(type,{caption}),mine);
        const mediaFrame=frame();
        const receiptTexts=nodes('Text').filter(node=>typeof node.props.children==='string' && /\d\d:\d\d/.test(node.props.children));
        expect(receiptTexts).toHaveLength(1);
        const insideFrame=mediaFrame.findAll(node=>node===receiptTexts[0]).length>0;
        expect(insideFrame).toBe(!caption);
        const card=nodes('Pressable').find(node=>style(node).borderWidth===1)!;
        const captionText=nodes('Text').find(node=>node.props.children===caption);
        renders.push({card:style(card),caption:captionText?style(captionText):null});
        await act(async()=>renderer.unmount());
      }
      expect(renders[0]).toEqual(renders[1]);
    }
  });
  it('fits a narrow window and updates after a viewport resize without changing the ratio',async()=>{
    const m=message('video');m.media={...m.media!,width:1080,height:1920};
    mocks.window={width:240,height:500};await mountVideo(m);
    expect(style(mediaBox()).width+10).toBeLessThanOrEqual((240-24)*.8);
    const first=style(mediaBox());
    mocks.window={width:390,height:844};
    await act(async()=>renderer.update(createElement(VideoMessageBubble,{message:m,mine:true})));
    const next=style(mediaBox());expect(next.width).toBeGreaterThan(first.width);
    expect(first.width/first.height).toBeCloseTo(9/16);expect(next.width/next.height).toBeCloseTo(9/16);
  });
  it.each([[4000,500],[500,4000]])('keeps controls, receipts and captions usable for %s × %s media',async(width,height)=>{
    for(const type of ['image','video'] as const){
      const m=message(type);m.media={...m.media!,width,height};
      await mountBubble(m);
      expect(style(frame()).minHeight).toBeGreaterThanOrEqual(44);
      expect(style(frame().parent!).width).toBeGreaterThanOrEqual(180);
      // No receipt text is clipped inside the narrow/short media frame.
      expect(mediaBox().findAll(node=>String(node.type)==='Text')).toHaveLength(0);
      expect(nodes('Text').some(node=>typeof node.props.children==='string' && /\d\d:\d\d/.test(node.props.children))).toBe(true);
      if(type==='video'){
        const controls=nodes('View').find(node=>node.props.testID==='media-controls')!;
        expect(controls.parent).toBe(frame());
        expect(style(controls).height).toBeGreaterThanOrEqual(56);
        expect(mediaBox().findAll(node=>String(node.type)==='Icon')).toHaveLength(0);
        await act(async()=>frame().props.onPress());expect(nodes('Video')).toHaveLength(1);
      }
      await act(async()=>renderer.unmount());
      await mountBubble({...m,caption:'تعليق واضح على صورة طويلة أو عريضة'});
      const caption=nodes('Text').find(node=>node.props.children==='تعليق واضح على صورة طويلة أو عريضة')!;
      expect(style(caption.parent!).width).toBeGreaterThanOrEqual(180);
      expect(style(mediaBox()).width/style(mediaBox()).height).toBeCloseTo(width/height);
      await act(async()=>renderer.unmount());
    }
  });
  it('learns missing legacy image dimensions on load and does not reuse them for another URI',async()=>{
    const m=message('image');m.media={...m.media!,width:null,height:null};
    await act(async()=>{renderer=create(createElement(ImageMessageBubble,{message:m,mine:false,onOpen:vi.fn()}));});
    await act(async()=>nodes('Image')[0].props.onLoad({nativeEvent:{source:{width:600,height:1200}}}));
    expect(style(mediaBox()).height/style(mediaBox()).width).toBe(2);
    const next={...m,id:'another',media:{...m.media!,localUri:'file:///another'}};
    await act(async()=>renderer.update(createElement(ImageMessageBubble,{message:next,mine:false,onOpen:vi.fn()})));
    expect(style(mediaBox()).width/style(mediaBox()).height).toBeCloseTo(4/3);
  });
  it('uses a safe fallback for invalid or incomplete dimensions',()=>{
    for(const [width,height] of [[0,5],[-2,5],[NaN,5],[Infinity,5],[5,0]]){
      expect(validMediaDimensions(width,height)).toBeNull();
    }
    expect(validMediaDimensions(100,null)).toBeNull();
    const size=fitMediaDimensions(null,230,420);
    expect(size.width/size.height).toBeCloseTo(4/3);
    expect(videoDisplayDimensions({width:1920,height:1080,orientation:'portrait'})).toEqual({width:1080,height:1920});
  });
});

describe('explicit video playback',()=>{
  it('downloads only on a tap, ignores rapid taps, and unmounts the player when closed',async()=>{
    let finish!:(uri:string)=>void;mocks.cache.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const longPress=vi.fn();await mountVideo(message('video'),{onLongPress:longPress});
    expect(mocks.cache).not.toHaveBeenCalled();expect(nodes('Video')).toHaveLength(0);
    await act(async()=>frame().props.onLongPress());expect(longPress).toHaveBeenCalledOnce();
    await act(async()=>{frame().props.onPress();frame().props.onPress();});
    expect(mocks.cache).toHaveBeenCalledOnce();expect(nodes('Video')).toHaveLength(0);
    await act(async()=>finish('file:///cached.mp4'));
    expect(nodes('Video')[0].props).toMatchObject({source:{uri:'file:///cached.mp4'},resizeMode:'contain',useNativeControls:true});
    await act(async()=>button('names.close').props.onPress());
    expect(nodes('Video')).toHaveLength(0);expect(frame()).toBeTruthy();
  });
  it('offers a retry after download failure and keeps share/save available in the viewer',async()=>{
    mocks.cache.mockResolvedValueOnce(null);await mountVideo();
    await act(async()=>frame().props.onPress());
    expect(nodes('Video')).toHaveLength(0);
    await act(async()=>button('media.retryDownload').props.onPress());
    expect(nodes('Video')).toHaveLength(1);
    await act(async()=>button('attachments.shareSave').props.onPress());
    expect(mocks.share).toHaveBeenCalledWith('file:///cached.mp4',expect.objectContaining({mimeType:'video/mp4'}));
  });
  it.each(['pending','uploading','failed'] as const)('does not play a %s upload',async status=>{
    const m=message('video');m.media={...m.media!,uploadStatus:status};
    const retry=vi.fn();await mountVideo(m,{onRetry:retry});
    await act(async()=>frame().props.onPress());expect(mocks.cache).not.toHaveBeenCalled();
    if(status==='failed'){
      await act(async()=>button('media.retryUpload').props.onPress());expect(retry).toHaveBeenCalledOnce();
    }
  });
  it('ignores a previous message download after the cell is reused',async()=>{
    let finish!:(uri:string)=>void;mocks.cache.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await mountVideo();await act(async()=>frame().props.onPress());
    await act(async()=>renderer.update(createElement(VideoMessageBubble,{message:message('video',{id:'new'}),mine:true})));
    await act(async()=>finish('file:///old.mp4'));
    expect(nodes('Video')).toHaveLength(0);
    await act(async()=>frame().props.onPress());expect(nodes('Video')[0].props.source.uri).toBe('file:///cached.mp4');
  });
  it('corrects rotated dimensions from the decoder and recovers from playback errors',async()=>{
    await mountVideo();await act(async()=>frame().props.onPress());
    await act(async()=>nodes('Video')[0].props.onReadyForDisplay({naturalSize:{width:1920,height:1080,orientation:'portrait'}}));
    expect(style(mediaBox()).width/style(mediaBox()).height).toBeCloseTo(9/16);
    expect(style(nodes('Video')[0]).width/style(nodes('Video')[0]).height).toBeCloseTo(9/16);
    await act(async()=>nodes('Video')[0].props.onError('bad-video'));
    expect(nodes('Video')).toHaveLength(0);expect(button('media.retryDownload')).toBeTruthy();
    expect(mocks.alert).toHaveBeenCalled();
  });
});

describe('attachment send preview',()=>{
  it.each(['image','video'] as const)('keeps the %s preview proportional and sends learned dimensions only on Send',async type=>{
    const onSend=vi.fn().mockResolvedValue(undefined);
    await act(async()=>{renderer=create(createElement(AttachmentComposer,{
      draft:{kind:'binary',mediaType:type,uri:'file:///picked',fileName:'picked',mimeType:type==='image'?'image/gif':'video/mp4',sizeBytes:4000},
      onClose:vi.fn(),onSend,
    }));});
    const node=nodes(type==='image'?'Image':'Video')[0];
    await act(async()=>type==='image'
      ? node.props.onLoad({nativeEvent:{source:{width:1080,height:1920}}})
      : node.props.onReadyForDisplay({naturalSize:{width:1920,height:1080,orientation:'portrait'}}));
    const box=style(nodes(type==='image'?'Image':'Video')[0]);
    expect(box.width/box.height).toBeCloseTo(9/16);expect(onSend).not.toHaveBeenCalled();
    const send=nodes('Pressable').find(node=>node.props.children?.props?.children==='attachments.send')!;
    await act(async()=>send.props.onPress());
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({width:1080,height:1920,mediaType:type}));
  });
});
