import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({storage:new Map<string,string>(),files:new Map<string,number>(),seq:0,write:vi.fn(),copy:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(k:string)=>mock.storage.get(k)??null,setItem:(k:string,v:string)=>mock.write(k,v)}}));
vi.mock('expo-crypto',()=>({randomUUID:()=>`uuid-${++mock.seq}`}));
vi.mock('expo-file-system',()=>({documentDirectory:'file:///docs/',
  makeDirectoryAsync:async()=>{},copyAsync:(args:any)=>mock.copy(args),
  getInfoAsync:async(uri:string)=>mock.files.has(uri)?{exists:true,isDirectory:false,size:mock.files.get(uri)}:{exists:false},
  deleteAsync:async(uri:string)=>{mock.files.delete(uri);},
}));
import { customStickerUri, deleteCustomSticker, loadCustomStickers, saveCustomSticker } from '../src/lib/customStickers';
import { DEFAULT_STICKER_EDITS as edits } from '../src/lib/stickerEditorModel';
const input={name:'Original',sourceUri:'file:///import.png',imageUri:'file:///export.png',sourceWidth:800,sourceHeight:400,edits};
beforeEach(()=>{mock.storage.clear();mock.files.clear();mock.seq=0;mock.files.set(input.sourceUri,2000);mock.files.set(input.imageUri,1000);
  mock.write.mockReset().mockImplementation(async(k:string,v:string)=>{mock.storage.set(k,v);});
  mock.copy.mockReset().mockImplementation(async({from,to}:any)=>{if(!mock.files.has(from))throw Error('missing');mock.files.set(to,mock.files.get(from)!);});
});
describe('durable per-account sticker library',()=>{
  it('copies original and flattened output before publishing and reloads without the picker files',async()=>{
    const [saved]=await saveCustomSticker('alice',input);
    expect(mock.files.get(customStickerUri('alice',saved,true))).toBe(2000);
    expect(mock.files.get(customStickerUri('alice',saved))).toBe(1000);
    mock.files.delete(input.sourceUri);mock.files.delete(input.imageUri);
    expect(await loadCustomStickers('alice')).toEqual([saved]);expect(await loadCustomStickers('bob')).toEqual([]);
    expect(customStickerUri('../bob',saved)).toContain('..%2Fbob/');
  });
  it('edits the saved source non-destructively and leaves sent-message copies intact',async()=>{
    const [old]=await saveCustomSticker('alice',input);mock.files.set('file:///docs/OfflineSMS/Outgoing/alice/sent.png',1000);
    const [saved]=await saveCustomSticker('alice',{...input,previous:old,sourceUri:customStickerUri('alice',old,true),name:'Edited',edits:{...edits,text:'مرحبا'}});
    expect(saved.id).toBe(old.id);expect(saved.revision).not.toBe(old.revision);expect(saved.edits.text).toBe('مرحبا');
    expect(mock.files.has(customStickerUri('alice',old))).toBe(false);
    await deleteCustomSticker('alice',saved.id);
    expect(await loadCustomStickers('alice')).toEqual([]);expect(mock.files.has(customStickerUri('alice',saved,true))).toBe(false);
    expect(mock.files.has('file:///docs/OfflineSMS/Outgoing/alice/sent.png')).toBe(true);
  });
  it('retains old files and manifest if persistence is interrupted',async()=>{
    const [old]=await saveCustomSticker('alice',input);const files=[...mock.files.keys()].sort();
    mock.write.mockRejectedValueOnce(Error('disk-full'));
    await expect(saveCustomSticker('alice',{...input,previous:old,name:'Unsaved'})).rejects.toThrow('disk-full');
    expect(await loadCustomStickers('alice')).toEqual([old]);expect([...mock.files.keys()].sort()).toEqual(files);
  });
  it('serializes simultaneous additions and rejects stale edits after deletion',async()=>{
    await Promise.all([saveCustomSticker('alice',input),saveCustomSticker('alice',{...input,name:'Second'})]);
    const list=await loadCustomStickers('alice');expect(list).toHaveLength(2);
    await deleteCustomSticker('alice',list[0].id);
    await expect(saveCustomSticker('alice',{...input,previous:list[0]})).rejects.toThrow('sticker-changed');
    expect(await loadCustomStickers('alice')).toHaveLength(1);
  });
  it('does not publish a missing/oversized file or allow manifest path traversal',async()=>{
    mock.files.set(input.imageUri,3*1024*1024);await expect(saveCustomSticker('alice',input)).rejects.toThrow('sticker-invalid');
    expect(mock.write).not.toHaveBeenCalled();
    mock.storage.set('customStickers.v1:alice',JSON.stringify([{id:'../../other',revision:'a',sizeBytes:2,sourceWidth:10,sourceHeight:10}]));
    expect(await loadCustomStickers('alice')).toEqual([]);
  });
});
