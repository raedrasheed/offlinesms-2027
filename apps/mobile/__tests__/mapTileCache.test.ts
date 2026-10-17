import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {mapFixture} from './helpers/mapFixture';
const mocks=vi.hoisted(()=>({files:new Map<string,string>(),fetch:vi.fn()}));
vi.mock('react-native',()=>({Platform:{OS:'android'}}));
vi.mock('expo-file-system',()=>({
  cacheDirectory:'file:///cache/',EncodingType:{Base64:'base64'},makeDirectoryAsync:async()=>{},
  getInfoAsync:async(path:string)=>({exists:mocks.files.has(path),isDirectory:false,size:mocks.files.has(path)?100:0}),
  readAsStringAsync:async(path:string)=>{if(!mocks.files.has(path))throw Error('missing');return mocks.files.get(path);},
  writeAsStringAsync:async(path:string,data:string)=>{mocks.files.set(path,data);},
  moveAsync:async({from,to}:any)=>{mocks.files.set(to,mocks.files.get(from)!);mocks.files.delete(from);},
  deleteAsync:async(path:string)=>{mocks.files.delete(path);},
}));
const tile=(x:number)=>({key:`14-${x}-0`,z:14,x,y:0,left:0,top:0});
const source={tiles:['https://tiles.openfreemap.org/planet/test_v1/{z}/{x}/{y}.pbf'],maxzoom:14};
let cachedMapTile:typeof import('../src/media/mapTileCache').cachedMapTile;
beforeEach(async()=>{
  vi.resetModules();vi.clearAllMocks();mocks.files.clear();vi.stubGlobal('fetch',mocks.fetch);
  mocks.fetch.mockImplementation(async(url:string)=>url.endsWith('/planet')?new Response(JSON.stringify(source)):new Response(mapFixture(),{headers:{'Content-Type':'application/vnd.mapbox-vector-tile'}}));
  cachedMapTile=(await import('../src/media/mapTileCache')).cachedMapTile;
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('visible vector map cache',()=>{
  it('does not fetch offscreen and coalesces a visible tile with an identifying native header',async()=>{
    expect(await cachedMapTile(tile(1),()=>false)).toBeNull();expect(mocks.fetch).not.toHaveBeenCalled();
    const [a,b]=await Promise.all([cachedMapTile(tile(1),()=>true),cachedMapTile(tile(1),()=>true)]);
    expect(a?.layers.water).toBeDefined();expect(b).toBe(a);
    expect(mocks.fetch.mock.calls.filter(([url])=>url.endsWith('.pbf'))).toHaveLength(1);
    expect(mocks.fetch.mock.calls[0][1].headers['User-Agent']).toContain('OfflineSMS/2.4.7');
  });
  it('reuses cached data offline, including after module restart',async()=>{
    await cachedMapTile(tile(2),()=>true);mocks.fetch.mockRejectedValue(Error('offline'));mocks.fetch.mockClear();
    vi.resetModules();cachedMapTile=(await import('../src/media/mapTileCache')).cachedMapTile;
    expect((await cachedMapTile(tile(2),()=>true))?.layers.water).toBeDefined();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect([...mocks.files.keys()]).toContain('file:///cache/OfflineSMS/MapVectors/test_v1-14-2-0.pbf');
  });
  it('rejects HTML, blocked responses and invalid provider URLs without caching them',async()=>{
    mocks.fetch.mockImplementation(async(url:string)=>url.endsWith('/planet')?new Response(JSON.stringify(source)):new Response('<html>denied</html>'));
    expect(await cachedMapTile(tile(3),()=>true)).toBeNull();expect([...mocks.files.keys()].some(p=>p.endsWith('.pbf'))).toBe(false);
    mocks.fetch.mockResolvedValue(new Response(mapFixture(),{headers:{'X-Blocked':'denied'}}));
    expect(await cachedMapTile(tile(4),()=>true)).toBeNull();
    vi.resetModules();mocks.files.clear();cachedMapTile=(await import('../src/media/mapTileCache')).cachedMapTile;
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({tiles:['https://example.org/{z}/{x}/{y}.pbf'],maxzoom:14})));
    expect(await cachedMapTile(tile(5),()=>true)).toBeNull();
  });
  it('times out stalled requests and permits a subsequent retry',async()=>{
    vi.useFakeTimers();
    mocks.fetch.mockImplementation((_url:string,options:any)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')))));
    const attempt=cachedMapTile(tile(6),()=>true);await vi.advanceTimersByTimeAsync(15001);expect(await attempt).toBeNull();
    mocks.fetch.mockImplementation(async(url:string)=>url.endsWith('/planet')?new Response(JSON.stringify(source)):new Response(mapFixture()));
    expect((await cachedMapTile(tile(6),()=>true))?.layers.water).toBeDefined();
  });
});
