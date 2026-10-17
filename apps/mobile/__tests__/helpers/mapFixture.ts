import Pbf from 'pbf';
/** Tiny valid MVT fixture: polygon, named road and labelled point. */
export function mapFixture():Uint8Array{
  const tile=new Pbf();
  for(const [name,type,geometry] of [
    ['water',3,[9,0,0,26,8192,0,0,8192,8191,0,15]],
    ['transportation',2,[9,0,4096,10,8192,0]],
    ['transportation_name',2,[9,0,4096,10,8192,0]],
    ['place',1,[9,1200,1200]],
  ] as const){
    tile.writeMessage(3,(_,layer:Pbf)=>{
      layer.writeStringField(1,name);layer.writeVarintField(15,2);layer.writeVarintField(5,4096);
      for(const key of ['name','class','name:ar'])layer.writeStringField(3,key);
      for(const value of ['Main Street','primary','الشارع الرئيسي'])layer.writeMessage(4,(s:string,p:Pbf)=>p.writeStringField(1,s),value);
      layer.writeMessage(2,(_,feature:Pbf)=>{feature.writeVarintField(3,type);feature.writePackedVarint(2,[0,0,1,1,2,2]);feature.writePackedVarint(4,[...geometry]);},null);
    },null);
  }
  return tile.finish();
}
