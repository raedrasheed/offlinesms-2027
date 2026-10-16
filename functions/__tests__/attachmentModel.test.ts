import { describe,it,expect } from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLocation,parseContact,attachmentMimeAllowed,attachmentLimit,inferAttachmentMime,cleanFileName,attachmentFallback} from '../src/chats/attachmentModel';
import {signatureMatches,fileNameMatchesMime} from '../src/chats/attachmentIntegrity';

describe('attachment boundary',()=>{
  it('keeps the server/client validation contract identical',()=>{
    expect(readFileSync('functions/src/chats/attachmentModel.ts','utf8')).toBe(readFileSync('apps/mobile/src/media/attachmentModel.ts','utf8'));
  });
  it('accepts equator/prime meridian and rejects nonfinite/out-of-range coordinates',()=>{
    expect(parseLocation({latitude:0,longitude:0})).toEqual({latitude:0,longitude:0});
    for(const v of [{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:NaN,longitude:1},{latitude:1,longitude:Infinity},{latitude:'31',longitude:34},null]) expect(parseLocation(v)).toBeNull();
    expect(attachmentFallback({kind:'location',location:{latitude:31.5,longitude:34.4}})).toContain('query=31.5,34.4');
  });
  it('shares only bounded selected contact fields; rejects URI injection',()=>{
    expect(parseContact({name:' Raed ',phones:['+970 599 123 456'],emails:[],secret:'not shared'})).toEqual({name:'Raed',phones:['+970 599 123 456'],emails:[]});
    expect(parseContact({name:'R',phones:['123;call=999'],emails:[]})).toBeNull();
    expect(parseContact({name:'R',phones:[],emails:['x@y.com?body=bad\nInjected']})).toBeNull();
    expect(parseContact({name:'R',phones:[],emails:[]})).toBeNull();
    expect(parseContact({name:'R',phones:Array(6).fill('1234'),emails:[]})).toBeNull();
  });
  it('restricts binaries by category and enforces bounded sizes',()=>{
    expect(attachmentMimeAllowed('file','application/pdf')).toBe(true);
    expect(attachmentMimeAllowed('video','video/mp4')).toBe(true);
    expect(attachmentMimeAllowed('image','image/gif')).toBe(true);
    expect(attachmentMimeAllowed('file','image/jpeg')).toBe(false);
    expect(attachmentMimeAllowed('file','application/x-msdownload')).toBe(false);
    expect(attachmentMimeAllowed('audio','audio/not-a-codec')).toBe(false);
    expect(attachmentLimit('file')).toBe(25*1024*1024);
    expect(attachmentLimit('image')).toBe(10*1024*1024);
    expect(inferAttachmentMime('التقرير.PDF','application/octet-stream')).toBe('application/pdf');
    expect(cleanFileName('../evil\u202ename.pdf')).not.toMatch(/[\/\u202e]/);
    expect(fileNameMatchesMime('file.exe','application/pdf')).toBe(false);
  });
  it('detects mislabeled files from bytes, not a claimed Content-Type',()=>{
    const bytes=(s:string)=>new Uint8Array(Buffer.from(s));
    expect(signatureMatches('application/pdf',bytes('%PDF-1.7\n'))).toBe(true);
    expect(signatureMatches('application/pdf',bytes('MZ executable'))).toBe(false);
    expect(signatureMatches('image/gif',bytes('GIF89a'))).toBe(true);
    expect(signatureMatches('image/png',new Uint8Array([137,80,78,71,13,10,26,10]))).toBe(true);
    expect(signatureMatches('video/mp4',bytes('0000ftypisom'))).toBe(true);
    expect(signatureMatches('text/plain',bytes('plain text'))).toBe(true);
    expect(signatureMatches('text/plain',new Uint8Array([0,1,2]))).toBe(false);
  });
  it.each([['pdf','application/pdf'],['mp3','audio/mpeg'],['mp4','video/mp4']])('preserves the %s extension in long filenames', (ext,mime)=>{
    const name=cleanFileName('report'.repeat(50)+'.'+ext);
    expect(name).toHaveLength(180);
    expect(name.endsWith('.'+ext)).toBe(true);
    expect(fileNameMatchesMime(name,mime)).toBe(true);
  });
});
