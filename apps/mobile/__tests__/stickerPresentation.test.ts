import { describe, expect, it } from 'vitest';
import { isStickerImage } from '../src/media/stickerPresentation';
import { payloadFromRemote } from '../src/lib/pollModel';
const media = { mimeType: 'image/png', sizeBytes: 1200, width: 512, height: 512 };
describe('sticker presentation compatibility', () => {
  it('keeps the explicit sticker marker and recognizes only legacy sticker export markers', () => {
    expect(isStickerImage({ type: 'image', media: { presentation: 'sticker' } })).toBe(true);
    for (const candidate of [{ media: { ...media, fileName: 'sticker.png' } }, { media: { ...media, fileName: 'sticker-1234-abcd.png' } },
      { media, text: 'Sticker' }, { media, text: 'Sticker: sticker-1234.png' }, { media, text: 'Photo: sticker-1234.png' }])
      expect(isStickerImage({ type: 'image', ...candidate })).toBe(true);
  });
  it('keeps ordinary photos, videos and captioned/invalid legacy images as ordinary attachments', () => {
    for (const candidate of [{ type: 'image', media }, { type: 'image', media: { ...media, fileName: 'photo.png' } },
      { type: 'image', media: { ...media, fileName: 'sticker.jpg' } }, { type: 'video', media: { ...media, fileName: 'sticker.png' } },
      { type: 'image', media: { ...media, fileName: 'sticker.png' }, caption: 'An ordinary image caption' },
      { type: 'image', media: { ...media, fileName: 'sticker.png', mimeType: 'image/jpeg' } },
      { type: 'image', media: { ...media, fileName: 'sticker.png', width: 1024 } },
      { type: 'image', media: { ...media, fileName: '../sticker.png' } }]) expect(isStickerImage(candidate)).toBe(false);
  });
  it('retains image filenames independently of the presentation flag during remote serialization', () => {
    const payload = payloadFromRemote('image', { media: { ...media, fileName: 'sticker-1234.png' } });
    expect(JSON.parse(payload!)).toEqual({ fileName: 'sticker-1234.png' });
    expect(isStickerImage({ type: 'image', media: { ...media, ...JSON.parse(payload!) } })).toBe(true);
    expect(payloadFromRemote('image', { media })).toBeNull();
  });
});
