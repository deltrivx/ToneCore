const { parseFile } = require('music-metadata');
(async () => {
  const f = process.argv[2];
  const md = await parseFile(f);
  const lyr = md.common.lyrics || [];
  console.log('lyrics entries:', lyr.length);
  console.log('first chars:', (lyr[0] || '').length);
  console.log('--- head ---');
  console.log((lyr[0] || '').split(/\r?\n/).slice(0, 6).join('\n'));
})().catch(e => console.log('ERR', String(e).slice(0, 120)));
