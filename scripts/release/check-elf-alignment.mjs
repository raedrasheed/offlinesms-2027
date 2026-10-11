#!/usr/bin/env node
// 16 KB page size, ELF side (Codex R6-2). Android 15+ devices with 16 KB pages
// load a native library only if every LOAD segment is aligned to at least
// 16 KB (p_align >= 0x4000). Zip alignment (zipalign -P 16) is a separate
// requirement and does not prove this.
//
//   node scripts/release/check-elf-alignment.mjs <file.apk|file.aab>
//
// Reads every 64-bit library (lib/arm64-v8a, lib/x86_64; in an AAB also
// <module>/lib/...) straight from the archive and checks each LOAD segment,
// as the NDK's check_elf_alignment.sh does. 32-bit ABIs are not affected.
// Exit code: 0 all aligned (or no 64-bit libraries) · 1 a library is not · 2 bad input.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MIN_ALIGN = 0x4000;
const LIB = /^(?:[^/]+\/)?lib\/(arm64-v8a|x86_64)\/[^/]+\.so$/;

/**
 * The p_align of every PT_LOAD segment of a 64-bit little-endian ELF file, or
 * an error string when the buffer is not one.
 */
export function elfLoadAlignments(buf) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) return 'not an ELF file';
  if (buf[4] !== 2) return 'not a 64-bit ELF file';
  if (buf[5] !== 1) return 'not little-endian';
  const phoff = Number(buf.readBigUInt64LE(32));
  const phentsize = buf.readUInt16LE(54);
  const phnum = buf.readUInt16LE(56);
  if (phentsize < 56 || phoff + phentsize * phnum > buf.length) return 'program headers out of range';
  const out = [];
  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize;
    if (buf.readUInt32LE(at) === 1 /* PT_LOAD */) out.push(Number(buf.readBigUInt64LE(at + 48)));
  }
  return out.length ? out : 'no LOAD segments';
}

/** Problems for one library: [] when every LOAD segment is 16 KB aligned. */
export function libraryProblems(name, buf) {
  const aligns = elfLoadAlignments(buf);
  if (typeof aligns === 'string') return [`${name}: ${aligns}`];
  const bad = aligns.filter(a => a < MIN_ALIGN);
  return bad.length ? [`${name}: LOAD segment aligned to ${bad.map(a => `0x${a.toString(16)}`).join(', ')}, needs >= 0x4000`] : [];
}

function run(archive) {
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(e => LIB.test(e));
  const problems = [];
  for (const e of entries) {
    const buf = execFileSync('unzip', ['-p', archive, e], { maxBuffer: 512 * 1024 * 1024 });
    problems.push(...libraryProblems(e, buf));
  }
  return { count: entries.length, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const archive = process.argv[2];
  if (!archive) { console.error('usage: check-elf-alignment.mjs <file.apk|file.aab>'); process.exit(2); }
  let result;
  try { result = run(archive); } catch (e) { console.error(`ELF alignment: ${e.message}`); process.exit(2); }
  const name = archive.split('/').pop();
  if (result.problems.length) {
    for (const p of result.problems) console.error(`ELF alignment: ${p}`);
    process.exit(1);
  }
  console.log(result.count
    ? `${name}: all ${result.count} 64-bit libraries have 16 KB aligned LOAD segments`
    : `${name}: no 64-bit native libraries`);
}
