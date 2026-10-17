import { describe, expect, it } from 'vitest';
import { cleanStickerEdits, DEFAULT_STICKER_EDITS as defaults, stickerImageLayout } from '../src/lib/stickerEditorModel';
describe('sticker editor geometry', () => {
  it('retains all of a rectangular import and centers its transparent padding', () => {
    expect(stickerImageLayout(800,400,300,defaults)).toEqual({width:300,height:150,left:0,top:75,rangeX:0,rangeY:75});
  });
  it('fills the crop and pans exactly to the edge without exposing empty pixels', () => {
    const edits={...defaults,fit:'cover' as const,zoom:2,x:1,y:-1};
    const rect=stickerImageLayout(800,400,300,edits);
    expect(rect.left).toBe(0);expect(rect.top+rect.height).toBe(300);
    expect(rect.width).toBe(1200);expect(rect.height).toBe(600);
  });
  it('uses rotated source dimensions and rejects invalid source sizes', () => {
    expect(stickerImageLayout(400,800,300,defaults)).toMatchObject({width:150,height:300,left:75,top:0});
    expect(()=>stickerImageLayout(0,800,300,defaults)).toThrow('sticker-invalid');
  });
  it('bounds persisted recipes, text, positions and colors', () => {
    expect(cleanStickerEdits({zoom:Infinity,x:20,y:-9,rotation:92,color:'url(x)',text:'x'.repeat(200),textSize:4})).toMatchObject({zoom:1,x:1,y:-1,rotation:0,color:'#FFFFFF',text:'x'.repeat(80),textSize:.15});
    expect(cleanStickerEdits(null)).toEqual(defaults);
  });
});
