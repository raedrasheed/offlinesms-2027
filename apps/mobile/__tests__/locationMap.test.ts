import {describe,it,expect} from 'vitest';
import {locationMapTiles,mapTileUrl,parseMapSource,TILE_SIZE} from '../src/media/locationMap';
import {filePresentation} from '../src/media/filePresentation';

describe('real location thumbnails',()=>{
  it('requests only tiles intersecting the shown viewport and centres the actual coordinate',()=>{
    const tiles=locationMapTiles({latitude:0,longitude:0},270,152);
    expect(tiles).toHaveLength(4);
    expect(tiles.find(tile=>tile.x===8192 && tile.y===8192)).toMatchObject({left:135,top:76});
    for(const tile of tiles){expect(tile.left).toBeLessThan(270);expect(tile.left+TILE_SIZE).toBeGreaterThan(0);expect(tile.top).toBeLessThan(152);expect(tile.top+TILE_SIZE).toBeGreaterThan(0);}
    const source=parseMapSource({tiles:['https://tiles.openfreemap.org/planet/test_v1/{z}/{x}/{y}.pbf'],maxzoom:14});
    expect(mapTileUrl(tiles[0],source)).toMatch(/^https:\/\/tiles\.openfreemap\.org\/planet\/test_v1\/14\/\d+\/\d+\.pbf$/);
  });
  it('wraps the date line and avoids inventing map positions beyond Mercator coverage',()=>{
    for(const longitude of [-180,180]){
      const tiles=locationMapTiles({latitude:0,longitude},270,152);
      expect(new Set(tiles.map(t=>t.x))).toEqual(new Set([16383,0]));
    }
    for(const latitude of [90,-90,NaN])expect(locationMapTiles({latitude,longitude:0},270,152)).toEqual([]);
  });
});
describe('file attachment presentation',()=>{
  it('shows the actual extension and readable file sizes, with document-specific badges',()=>{
    expect(filePresentation('شهادة.doc','application/msword',40960)).toMatchObject({type:'DOC',badge:'W',size:'40 kB'});
    expect(filePresentation('sheet.xlsx',null,1024*1024)).toMatchObject({badge:'X',size:'1 MB'});
    expect(filePresentation('a.pdf',null,15)).toMatchObject({badge:'PDF',size:'15 B'});
    expect(filePresentation(undefined,'application/pdf',NaN)).toMatchObject({type:'PDF',size:'0 B'});
  });
});
