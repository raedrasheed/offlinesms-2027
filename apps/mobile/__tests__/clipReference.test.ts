import { describe, expect, it } from 'vitest';
import { clipIdFromUrl, parseClipReference, validClipId } from '../src/lib/clipReference';
import { payloadFromRemote } from '../src/lib/pollModel';
import { messagePreview } from '../../../functions/src/notifications/notifyLogic';

describe('protected clip links', () => {
  it.each(['offlinesms://clips/Abc-123_X', 'https://links.offlinesms.com/clips/Abc-123_X', 'https://offlinesms.com/clips/Abc-123_X/?source=share'])('accepts the configured app link %s', value => {
    expect(clipIdFromUrl(value)).toBe('Abc-123_X');
  });
  it.each([null, '', 'javascript:alert(1)', 'http://offlinesms.com/clips/a', 'https://offlinesms.com.evil.test/clips/a',
    'https://evil.test/clips/a', 'https://user@offlinesms.com/clips/a', 'https://offlinesms.com:444/clips/a',
    'offlinesms://join/a', 'offlinesms://clips/a/b', 'https://offlinesms.com/clips/a%2Fb',
    'https://offlinesms.com/clips/%2e%2e', 'https://offlinesms.com/clips/', 'https://offlinesms.com/clips/'+'x'.repeat(129)])('rejects an untrusted or malformed link %s', value => {
    expect(clipIdFromUrl(value)).toBeNull();
  });
  it('persists only the validated opaque ID, dropping private metadata', () => {
    const payload = payloadFromRemote('clip', {clipId:'clip123',caption:'private',thumbnailUrl:'https://secret',media:{downloadURL:'https://secret'}});
    expect(JSON.parse(payload!)).toEqual({clipId:'clip123'});
    expect(parseClipReference(payload)).toBe('clip123');
    expect(payloadFromRemote('clip', {clipId:'clips/other'})).toBeNull();
    expect(parseClipReference('{')).toBeNull();
    expect(parseClipReference('{"clipId":1}')).toBeNull();
    expect(validClipId({})).toBe(false);
  });
  it('keeps push previews generic in both languages even when input contains metadata', () => {
    expect(messagePreview({type:'clip',text:'private caption'},'en')).toBe('▶ Video clip');
    expect(messagePreview({type:'clip',text:'private caption'},'ar')).toBe('▶ مقطع فيديو');
  });
});
