import {describe,it,expect} from 'vitest';
import {clipMapLine,clipMapPolygon,decodeMapTile,drawMapTile,visibleMapLabels} from '../src/media/vectorMap';
import {mapFixture} from './helpers/mapFixture';

describe('vector location preview',()=>{
  it('decodes real MVT geometry and clips it to the visible map',()=>{
    const drawing=drawMapTile(decodeMapTile(mapFixture()),{key:'test',z:14,x:0,y:0,left:-400,top:-400},270,152,'ar');
    expect(drawing.paths.some(path=>path.fill==='#B5DAEC')).toBe(true);
    expect(drawing.paths.some(path=>path.stroke==='#F9D77D')).toBe(true);
    for(const path of drawing.paths){
      const points=[...path.d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)];
      for(const [,x,y] of points){expect(Number(x)).toBeGreaterThanOrEqual(0);expect(Number(x)).toBeLessThanOrEqual(270);expect(Number(y)).toBeGreaterThanOrEqual(0);expect(Number(y)).toBeLessThanOrEqual(152);}
    }
  });
  it('preserves geometry crossing the screen while discarding geometry outside it',()=>{
    const bounds={left:0,top:0,right:100,bottom:60};
    expect(clipMapLine({x:-20,y:30},{x:120,y:30},bounds)).toEqual([{x:0,y:30},{x:100,y:30}]);
    expect(clipMapLine({x:-20,y:-10},{x:120,y:-10},bounds)).toEqual([]);
    const polygon=clipMapPolygon([{x:-20,y:-20},{x:120,y:-20},{x:120,y:80},{x:-20,y:80}],bounds);
    expect(new Set(polygon.map(p=>`${p.x}/${p.y}`))).toEqual(new Set(['0/0','100/0','100/60','0/60']));
  });
  it('rejects error pages and avoids duplicate or overlapping labels',()=>{
    expect(()=>decodeMapTile(new TextEncoder().encode('<html>denied</html>'))).toThrow();
    const labels=[{text:'Street',x:30,y:35,angle:0,priority:1},{text:'Street',x:180,y:35,angle:0,priority:1},{text:'Near',x:33,y:36,angle:0,priority:1},{text:'Place',x:210,y:45,angle:0,priority:0}];
    expect(visibleMapLabels([{paths:[],labels}],270,152).map(l=>l.text)).toEqual(['Place','Street']);
  });
});
