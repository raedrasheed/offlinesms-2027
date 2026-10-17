import {describe,it,expect} from 'vitest';
import {validCustomStickerMetadata as server,isCustomStickerMessage} from '../src/chats/attachmentModel';
import {validCustomStickerMetadata as mobile} from '../../apps/mobile/src/media/attachmentModel';
import {validStickerPngHeader} from '../src/chats/attachmentIntegrity';
import {messagePreview} from '../src/notifications/notifyLogic';
const valid={mimeType:'image/png',sizeBytes:1000,width:512,height:512};
describe('custom sticker media contract',()=>{
  it.each([valid,{...valid,width:513},{...valid,height:1},{...valid,sizeBytes:2*1024*1024+1},{...valid,mimeType:'image/jpeg'},
    {...valid,sizeBytes:-1},{...valid,sizeBytes:NaN},{...valid,width:'512'}])('keeps client and server validation identical for %j',value=>{
    expect(mobile(value)).toBe(server(value));expect(server(value)).toBe(value===valid);
  });
  it('reads actual PNG IHDR dimensions including sliced buffers',()=>{
    const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(512,16);bytes.writeUInt32BE(512,20);
    expect(validStickerPngHeader(bytes)).toBe(true);expect(validStickerPngHeader(Buffer.concat([Buffer.alloc(5),bytes]).subarray(5))).toBe(true);
    bytes.writeUInt32BE(2048,16);expect(validStickerPngHeader(bytes)).toBe(false);expect(validStickerPngHeader(bytes.subarray(0,24))).toBe(false);
  });
  it('keeps older images ordinary and labels verified custom stickers in both notification languages',()=>{
    expect(isCustomStickerMessage({type:'image'})).toBe(false);
    expect(isCustomStickerMessage({type:'voice',media:{presentation:'sticker'}})).toBe(false);
    const message={type:'image',media:{presentation:'sticker'}};
    expect(isCustomStickerMessage(message)).toBe(true);expect(messagePreview(message,'en')).toBe('Sticker');expect(messagePreview(message,'ar')).toBe('ملصق');
    expect(messagePreview({type:'image'},'en')).toBe('📷 Photo');
  });
});
