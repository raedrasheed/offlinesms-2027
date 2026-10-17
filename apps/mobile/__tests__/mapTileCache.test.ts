import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const fs=vi.hoisted(()=>({files:new Map<string,{text:string;mtime:number}>(),download:vi.fn()}));
vi.mock('expo-file-system',()=>({
  documentDirectory:'file:///test/',FileSystemSessionType:{FOREGROUND:1},
  makeDirectoryAsync:async()=>{},
  getInfoAsync:async(path:string)=>({exists:fs.files.has(path),isDirectory:false,size:fs.files.has(path)?10:0,modificationTime:fs.files.get(path)?.mtime ?? 0}),
  readAsStringAsync:async(path:string)=>{const file=fs.files.get(path);if(!file)throw Error('missing');return file.text;},
  writeAsStringAsync:async(path:string,text:string)=>{fs.files.set(path,{text,mtime:Date.now()/1000});},
  moveAsync:async({from,to}:any)=>{fs.files.set(to,fs.files.get(from)!);fs.files.delete(from);},
  deleteAsync:async(path:string)=>{fs.files.delete(path);},downloadAsync:fs.download,
}));
import {cachedMapTile,tileMetadata} from '../src/media/mapTileCache';
const tile=(x:number)=>({key:`16-${x}-0`,z:16,x,y:0,left:0,top:0});
const path=(x:number)=>`file:///test/OfflineSMS/MapTiles/16-${x}-0.png`;
beforeEach(()=>{
  fs.files.clear();vi.clearAllMocks();vi.spyOn(Date,'now').mockReturnValue(1800000000000);
  fs.download.mockImplementation(async(_url:string,p:string)=>{fs.files.set(p,{text:'PNG',mtime:Date.now()/1000});return {status:200,mimeType:'image/png',headers:{ETag:'"map-v1"','Cache-Control':'max-age=604800'}};});
});
afterEach(()=>{vi.restoreAllMocks();});
describe('map tile cache',()=>{
  it('never fetches an offscreen tile and coalesces requests for a visible tile',async()=>{
    expect(await cachedMapTile(tile(1),()=>false)).toBeNull();expect(fs.download).not.toHaveBeenCalled();
    const results=await Promise.all([cachedMapTile(tile(2),()=>true),cachedMapTile(tile(2),()=>true)]);
    expect(results).toEqual([path(2),path(2)]);expect(fs.download).toHaveBeenCalledOnce();
    expect(fs.download.mock.calls[0][2].headers['User-Agent']).toContain('OfflineSMS/');
    expect(await cachedMapTile(tile(2),()=>true)).toBe(path(2));expect(fs.download).toHaveBeenCalledOnce();
  });
  it('revalidates an expired tile and preserves it on 304 or a connection error',async()=>{
    await cachedMapTile(tile(3),()=>true);
    fs.files.set(`${path(3)}.json`,{text:JSON.stringify({expiresAt:0,etag:'"map-v1"'}),mtime:0});
    fs.download.mockResolvedValueOnce({status:304,mimeType:null,headers:{'Cache-Control':'max-age=604800'}});
    expect(await cachedMapTile(tile(3),()=>true)).toBe(path(3));
    expect(fs.download.mock.calls[1][2].headers['If-None-Match']).toBe('"map-v1"');
    fs.files.set(`${path(3)}.json`,{text:JSON.stringify({expiresAt:0}),mtime:0});fs.download.mockRejectedValueOnce(Error('offline'));
    expect(await cachedMapTile(tile(3),()=>true)).toBe(path(3));
  });
  it('does not treat HTML errors as map images',async()=>{
    fs.download.mockResolvedValueOnce({status:200,mimeType:'text/html',headers:{}});
    expect(await cachedMapTile(tile(4),()=>true)).toBeNull();expect(fs.files.has(path(4))).toBe(false);
  });
  it('rejects an access-denied PNG even when a gateway reports HTTP 200',async()=>{
    fs.download.mockResolvedValueOnce({status:200,mimeType:'image/png',headers:{'X-Blocked':'Access denied'}});
    expect(await cachedMapTile(tile(5),()=>true)).toBeNull();expect(fs.files.has(path(5))).toBe(false);
  });
  it('honors cache headers or keeps tiles for seven days when headers are absent',()=>{
    expect(tileMetadata({},0).expiresAt).toBe(604800000);
    expect(tileMetadata({'Cache-Control':'public, max-age=86400',Age:'60',ETag:'x'},0)).toEqual({expiresAt:86340000,etag:'x'});
  });
});
