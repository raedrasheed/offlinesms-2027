// scripts/release/check-elf-alignment.mjs — the ELF half of the 16 KB page size
// check (Codex R6-2). Zip alignment alone does not prove a library loads on a
// 16 KB device; every LOAD segment's p_align must be at least 0x4000. The
// libraries below are ELF headers built byte by byte in the layout the NDK writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { elfLoadAlignments, libraryProblems, MIN_ALIGN } from '../../../scripts/release/check-elf-alignment.mjs';

const SCRIPT = resolve(__dirname, '../../../scripts/release/check-elf-alignment.mjs');
const PT_LOAD = 1;
const PT_DYNAMIC = 2;

/** A 64-bit little-endian ELF header plus program headers (type, p_align). */
function elf64(segments: [type: number, align: number][], opts: { cls?: number; data?: number } = {}) {
  const phoff = 64;
  const buf = Buffer.alloc(phoff + 56 * segments.length);
  buf.writeUInt32BE(0x7f454c46, 0);
  buf[4] = opts.cls ?? 2;
  buf[5] = opts.data ?? 1;
  buf[6] = 1;
  buf.writeUInt16LE(3, 16); // ET_DYN
  buf.writeUInt16LE(183, 18); // EM_AARCH64
  buf.writeBigUInt64LE(BigInt(phoff), 32);
  buf.writeUInt16LE(64, 52);
  buf.writeUInt16LE(56, 54);
  buf.writeUInt16LE(segments.length, 56);
  segments.forEach(([type, align], i) => {
    const at = phoff + i * 56;
    buf.writeUInt32LE(type, at);
    buf.writeBigUInt64LE(BigInt(align), at + 48);
  });
  return buf;
}

describe('ELF LOAD segment alignment', () => {
  it('reads p_align of LOAD segments only', () => {
    expect(elfLoadAlignments(elf64([[PT_LOAD, 0x4000], [PT_DYNAMIC, 8], [PT_LOAD, 0x10000]]))).toEqual([0x4000, 0x10000]);
  });

  it('accepts 16 KB and 64 KB alignment', () => {
    expect(MIN_ALIGN).toBe(0x4000);
    expect(libraryProblems('a.so', elf64([[PT_LOAD, 0x4000], [PT_LOAD, 0x4000]]))).toEqual([]);
    expect(libraryProblems('b.so', elf64([[PT_LOAD, 0x10000]]))).toEqual([]);
  });

  it('refuses a library with any 4 KB LOAD segment', () => {
    const problems = libraryProblems('lib/arm64-v8a/old.so', elf64([[PT_LOAD, 0x4000], [PT_LOAD, 0x1000]]));
    expect(problems).toEqual(['lib/arm64-v8a/old.so: LOAD segment aligned to 0x1000, needs >= 0x4000']);
  });

  it('refuses what it cannot read instead of passing it', () => {
    expect(libraryProblems('x.so', Buffer.from('not an elf file, just some bytes that are long enough to look at.....'))).toEqual(['x.so: not an ELF file']);
    expect(libraryProblems('x.so', elf64([[PT_LOAD, 0x4000]], { cls: 1 }))).toEqual(['x.so: not a 64-bit ELF file']);
    expect(libraryProblems('x.so', elf64([[PT_LOAD, 0x4000]], { data: 2 }))).toEqual(['x.so: not little-endian']);
    expect(libraryProblems('x.so', elf64([[PT_DYNAMIC, 8]]))).toEqual(['x.so: no LOAD segments']);
    const truncated = elf64([[PT_LOAD, 0x4000], [PT_LOAD, 0x4000]]).subarray(0, 64 + 56);
    expect(libraryProblems('x.so', truncated)).toEqual(['x.so: program headers out of range']);
  });
});

describe('ELF alignment check, command line', () => {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'elf-check-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  function archive(name: string, entries: Record<string, Buffer>) {
    const d = mkdtempSync(join(dir, `${name}-`));
    const names = Object.keys(entries);
    names.forEach((e, i) => writeFileSync(join(d, String(i)), entries[e]));
    const file = join(d, name);
    const py = 'import os,sys,json,zipfile\nd=sys.argv[1]\nz=zipfile.ZipFile(sys.argv[2],"w")\n' +
      'for i,e in enumerate(json.loads(sys.argv[3])): z.write(os.path.join(d,str(i)),e)\nz.close()\n';
    expect(spawnSync('python3', ['-c', py, d, file, JSON.stringify(names)]).status).toBe(0);
    return file;
  }
  const cli = (file: string) => spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });

  const good = elf64([[PT_LOAD, 0x4000], [PT_LOAD, 0x4000]]);
  const old = elf64([[PT_LOAD, 0x1000], [PT_LOAD, 0x1000]]);

  it('passes an APK whose 64-bit libraries are all aligned', () => {
    const r = cli(archive('ok.apk', { 'lib/arm64-v8a/liba.so': good, 'lib/x86_64/liba.so': good, 'classes.dex': Buffer.from('dex') }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('all 2 64-bit libraries have 16 KB aligned LOAD segments');
  });

  it('fails an AAB with one unaligned library in a module', () => {
    const r = cli(archive('bad.aab', { 'base/lib/arm64-v8a/liba.so': good, 'base/lib/x86_64/libold.so': old }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('base/lib/x86_64/libold.so: LOAD segment aligned to 0x1000, 0x1000');
  });

  it('ignores 32-bit ABIs, which 16 KB devices do not load', () => {
    const r = cli(archive('v7.apk', { 'lib/armeabi-v7a/libold.so': old, 'lib/x86/libold.so': old }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no 64-bit native libraries');
  });

  it('exits 2 for a file it cannot open', () => {
    expect(cli(join(dir, 'missing.apk')).status).toBe(2);
  });
});
