import type { LocationAttachment } from './attachmentModel';
export const TILE_SIZE=256;
export type MapTile={key:string;z:number;x:number;y:number;left:number;top:number};
/** Only the tiles intersecting this preview, at one zoom. No area prefetch. */
export function locationMapTiles(location:LocationAttachment,width:number,height:number):MapTile[] {
  if(!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude)>85.05112878 || Math.abs(location.longitude)>180 || width<=0 || height<=0)return [];
  const z=16,n=2**z,lat=location.latitude*Math.PI/180;
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
export const mapTileUrl=(tile:MapTile)=>`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
export const MAP_ATTRIBUTION='© OpenStreetMap contributors';
export const MAP_COPYRIGHT_URL='https://www.openstreetmap.org/copyright';
