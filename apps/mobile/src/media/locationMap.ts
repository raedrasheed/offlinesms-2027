import type { LocationAttachment } from './attachmentModel';
// OpenFreeMap's vector source ends at z14. Display that geometry at z16,
// rather than requesting nonexistent z16 tiles or stretching a raster image.
export const TILE_SIZE=1024;
export type MapTile={key:string;z:number;x:number;y:number;left:number;top:number};
/** Only the tiles intersecting this preview, at one zoom. No area prefetch. */
export function locationMapTiles(location:LocationAttachment,width:number,height:number):MapTile[] {
  if(!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude)>85.05112878 || Math.abs(location.longitude)>180 || width<=0 || height<=0)return [];
  const z=14,n=2**z,lat=location.latitude*Math.PI/180;
  const px=(location.longitude+180)/360*n*TILE_SIZE;
  const py=(1-Math.asinh(Math.tan(lat))/Math.PI)/2*n*TILE_SIZE;
  const left=px-width/2,top=py-height/2,tiles:MapTile[]=[];
  for(let y=Math.floor(top/TILE_SIZE);y<=Math.floor((top+height-0.001)/TILE_SIZE);y++) {
    if(y<0 || y>=n)continue;
    for(let x=Math.floor(left/TILE_SIZE);x<=Math.floor((left+width-0.001)/TILE_SIZE);x++) {
      const wrappedX=((x%n)+n)%n;
      tiles.push({key:`${z}-${wrappedX}-${y}`,z,x:wrappedX,y,left:x*TILE_SIZE-left,top:y*TILE_SIZE-top});
    }
  }
  return tiles;
}
export const MAP_SOURCE_URL='https://tiles.openfreemap.org/planet';
export const MAP_ATTRIBUTIONS=[
  {label:'OpenFreeMap',url:'https://openfreemap.org/'},
  {label:'© OpenMapTiles',url:'https://www.openmaptiles.org/'},
  {label:'© OpenStreetMap',url:'https://www.openstreetmap.org/copyright'},
] as const;
export type MapSource={template:string;version:string;expiresAt:number};
export function parseMapSource(value:unknown,now=Date.now()):MapSource {
  const data=value as {tiles?:unknown[];maxzoom?:number};
  const template=data?.tiles?.[0];
  const match=typeof template==='string' && template.match(/^https:\/\/tiles\.openfreemap\.org\/planet\/([a-zA-Z0-9_-]+)\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
  if(!match || (data.maxzoom ?? 0)<14)throw Error('invalid-map-source');
  return {template:template as string,version:match[1],expiresAt:now+24*60*60*1000};
}
export const mapTileUrl=(tile:MapTile,source:MapSource)=>source.template.replace('{z}',String(tile.z)).replace('{x}',String(tile.x)).replace('{y}',String(tile.y));
