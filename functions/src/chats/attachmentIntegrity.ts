import { MIME_EXTENSIONS } from './attachmentModel';

/** Fast format check, not an antivirus scan. ZIP/Office archives are never extracted. */
export function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  const hex = (...values:number[]) => values.every((v,i) => bytes[i] === v);
  const text = (start:number,end:number) => String.fromCharCode(...bytes.slice(start,end));
  if (mime === 'image/jpeg') return hex(0xff,0xd8,0xff);
  if (mime === 'image/png') return hex(137,80,78,71,13,10,26,10);
  if (mime === 'image/gif') return ['GIF87a','GIF89a'].includes(text(0,6));
  if (mime === 'image/webp') return text(0,4) === 'RIFF' && text(8,12) === 'WEBP';
  if (mime === 'application/pdf') return text(0,5) === '%PDF-';
  if (mime === 'application/zip' || mime.startsWith('application/vnd.openxmlformats-')) return hex(0x50,0x4b,3,4) || hex(0x50,0x4b,5,6);
  if (['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(mime)) return hex(0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1);
  if (mime === 'text/plain' || mime === 'text/csv') return bytes.length > 0 && !bytes.some(b => b === 0);
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return text(0,4) === 'RIFF' && text(8,12) === 'WAVE';
  if (mime === 'audio/ogg') return text(0,4) === 'OggS';
  if (mime === 'audio/mpeg') return text(0,3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (mime === 'audio/aac') return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0 || text(4,8) === 'ftyp';
  if (mime === 'video/webm') return hex(0x1a,0x45,0xdf,0xa3);
  if (['audio/m4a','audio/mp4','audio/x-m4a','video/mp4'].includes(mime)) return text(4,8) === 'ftyp';
  if (mime === 'video/quicktime') return ['ftyp','moov','wide','mdat'].includes(text(4,8));
  return false;
}
export function fileNameMatchesMime(fileName:string,mime:string):boolean {
  const ext=fileName.toLowerCase().split('.').pop();
  return ext === MIME_EXTENSIONS[mime] || mime === 'image/jpeg' && ext === 'jpeg';
}
