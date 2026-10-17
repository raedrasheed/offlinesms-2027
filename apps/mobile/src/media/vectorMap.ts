import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {TILE_SIZE,type MapTile} from './locationMap';

export type MapPath={d:string;fill:string;stroke?:string;strokeWidth?:number};
export type MapLabel={text:string;x:number;y:number;angle:number;priority:number};
export type MapDrawing={paths:MapPath[];labels:MapLabel[]};
type Point={x:number;y:number};
type Bounds={left:number;top:number;right:number;bottom:number};
// Clip before sending paths over the native SVG bridge. A coastal/land-use
// polygon can contain thousands of vertices outside this tiny viewport.
export function clipMapPolygon(input:Point[],box:Bounds):Point[]{
  let points=input;
  for(const [axis,value,keepGreater] of [['x',box.left,true],['x',box.right,false],['y',box.top,true],['y',box.bottom,false]] as const){
    const output:Point[]=[];if(!points.length)return output;
    let previous=points[points.length-1],wasInside=keepGreater?previous[axis]>=value:previous[axis]<=value;
    for(const point of points){
      const inside=keepGreater?point[axis]>=value:point[axis]<=value;
      if(inside!==wasInside){const t=(value-previous[axis])/(point[axis]-previous[axis]);output.push({x:previous.x+t*(point.x-previous.x),y:previous.y+t*(point.y-previous.y)});}
      if(inside)output.push(point);previous=point;wasInside=inside;
    }
    points=output;
  }
  return points;
}
export function clipMapLine(a:Point,b:Point,box:Bounds):Point[] {
  let start=0,end=1;const dx=b.x-a.x,dy=b.y-a.y;
  for(const [p,q] of [[-dx,a.x-box.left],[dx,box.right-a.x],[-dy,a.y-box.top],[dy,box.bottom-a.y]]){
    if(p===0){if(q<0)return [];continue;}
    const t=q/p;if(p<0)start=Math.max(start,t);else end=Math.min(end,t);if(start>end)return [];
  }
  return [{x:a.x+start*dx,y:a.y+start*dy},{x:a.x+end*dx,y:a.y+end*dy}];
}
const LAYERS=['landcover','landuse','park','water','waterway','building','transportation','transportation_name','place','poi'];
export function decodeMapTile(bytes:Uint8Array):VectorTile {
  if(bytes.length===0 || bytes.length>4*1024*1024)throw Error('invalid-map-data');
  const tile=new VectorTile(new Pbf(bytes));
  if(!Object.keys(tile.layers).length)throw Error('invalid-map-data');
  return tile;
}
/** Draw actual OpenMapTiles geometry; no placeholder roads or invented labels. */
export function drawMapTile(tile:VectorTile,placement:MapTile,width:number,height:number,language:string):MapDrawing {
  const groups=new Map<string,MapPath>(),labels:MapLabel[]=[];
  const box={left:Math.max(0,placement.left),top:Math.max(0,placement.top),right:Math.min(width,placement.left+TILE_SIZE),bottom:Math.min(height,placement.top+TILE_SIZE)};
  let pointsRead=0,featuresRead=0;
  const add=(d:string,fill:string,stroke?:string,strokeWidth?:number)=>{
    const key=`${fill}/${stroke}/${strokeWidth}`;
    const old=groups.get(key);if(old)old.d+=d;else groups.set(key,{d,fill,stroke,strokeWidth});
  };
  for(const name of LAYERS){
    const layer=tile.layers[name];if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      if(++featuresRead>30000)throw Error('map-data-too-large');
      const feature=layer.feature(i),p=feature.properties,kind=String(p.class ?? '');
      const factor=TILE_SIZE/feature.extent;
      const bbox=feature.bbox();
      if(placement.left+bbox[2]*factor<0 || placement.top+bbox[3]*factor<0 || placement.left+bbox[0]*factor>width || placement.top+bbox[1]*factor>height)continue;
      const geometry=feature.loadGeometry().map(line=>line.map(point=>({x:placement.left+point.x*factor,y:placement.top+point.y*factor})));
      const all=geometry.flat();pointsRead+=all.length;
      if(pointsRead>300000)throw Error('map-data-too-large');
      if(!all.length)continue;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const point of all){minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
      if(maxX<0 || maxY<0 || minX>width || minY>height)continue;
      if(name==='transportation_name' || name==='place' || name==='poi'){
        const text=String(p[`name:${language.split('-')[0]}`] || (language.startsWith('en')?p.name_en:'') || p.name || '').slice(0,64);
        if(!text || labels.length>=80)continue;
        let anchor:Point|undefined,angle=0,longest=0;
        if(feature.type===1)anchor=all[0];
        else for(const line of geometry)for(let j=1;j<line.length;j++){
          const a=line[j-1],b=line[j],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},length=Math.hypot(b.x-a.x,b.y-a.y);
          if(length>longest && mid.x>20 && mid.x<width-20 && mid.y>18 && mid.y<height-28){
            longest=length;anchor=mid;angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
            if(angle>90)angle-=180;if(angle< -90)angle+=180;
          }
        }
        if(anchor && anchor.x>=Math.max(12,placement.left) && anchor.x<=Math.min(width-12,placement.left+TILE_SIZE) && anchor.y>=18 && anchor.y<height-28)
          labels.push({text,...anchor,angle,priority:name==='place'?0:name==='transportation_name'?1:2});
        continue;
      }
      const parts=feature.type===3?geometry.map(ring=>clipMapPolygon(ring,box)):geometry.flatMap(line=>line.slice(1).map((point,i)=>clipMapLine(line[i],point,box)));
      const d=parts.filter(line=>line.length>1).map(line=>line.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('')+(feature.type===3?'Z':'')).join('');
      if(!d)continue;
      if(name==='water')add(d,'#B5DAEC');
      else if(name==='waterway')add(d,'none','#9BCFE7',2);
      else if(name==='building')add(d,'#E1DCD4','#D4CEC5',0.5);
      else if(name==='transportation'){
        const major=['motorway','trunk','primary','secondary'].includes(kind);
        const narrow=['path','track','service'].includes(kind);
        const size=major?8:narrow?2:5;
        add(d,'none',major?'#DBB666':'#D4CEC5',size+1.8);
        add(d,'none',major?'#F9D77D':'#FFFFFF',size);
      }else{
        const green=name==='park' || ['wood','grass','farmland','park','cemetery','pitch','playground','garden'].includes(kind);
        add(d,green?'#D6E7C4':kind==='sand'?'#F0E7CD':'#ECE7DC');
      }
    }
  }
  return {paths:[...groups.values()],labels};
}
export function visibleMapLabels(drawings:MapDrawing[],width:number,height:number):MapLabel[]{
  const result:MapLabel[]=[];
  for(const label of drawings.flatMap(d=>d.labels).sort((a,b)=>a.priority-b.priority)){
    if(result.length>=8)break;
    if(Math.abs(label.x-width/2)<35 && label.y>height/2-45 && label.y<height/2+10)continue;
    if(result.some(old=>old.text===label.text || Math.abs(old.x-label.x)<60 && Math.abs(old.y-label.y)<22))continue;
    result.push(label);
  }
  return result;
}
