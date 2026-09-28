// 探查本地 FLAC 是否真的写了内嵌歌词，以及其时间轴
import { parseFile } from 'music-metadata';
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(flac|mp3|m4a)$/i.test(e.name)) out.push(p);
  }
  return out;
};
const files = walk(root).slice(0, 6);
for (const f of files) {
  try {
    const md = await parseFile(f);
    const lyr = md.common.lyrics || [];
    const has = lyr.length && lyr[0] && lyr[0].trim().length > 0;
    console.log(path.basename(f).padEnd(42), 'lyrics=', has ? 'YES' : 'no', ' chars=', (lyr[0]||'').length);
    if (has) {
      const lines = (lyr[0]||'').split(/\r?\n/).filter(Boolean).slice(0, 5);
      lines.forEach(l => console.log('     ', l.slice(0, 70)));
    }
  } catch (e) { console.log(path.basename(f), 'ERR', String(e).slice(0, 60)); }
}
