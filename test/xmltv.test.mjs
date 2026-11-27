import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createXmltvParser,
  createEpgCollector,
  parseXmltvTime,
  decodeEntities,
  nowNext,
  range,
} from '../electron/xmltv.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
  <programme start="20261126200000 +0000" stop="20261126210000 +0000" channel="BBC1.uk">
    <title lang="en">News &amp; Weather</title>
    <desc lang="en"><![CDATA[Headlines <b>tonight</b>]]></desc>
  </programme>
  <programme start="20261126210000 +0000" stop="20261126220000 +0000" channel="bbc1.uk">
    <title>Drama &#8211; Part 2</title>
  </programme>
  <programme start="20261126220000 +0100" stop="20261126230000 +0100" channel="other.de">
    <title>Ignored</title>
  </programme>
</tv>`;

test('parseXmltvTime handles offsets', () => {
  assert.equal(parseXmltvTime('20261126200000 +0000'), Date.UTC(2026, 10, 26, 20));
  assert.equal(parseXmltvTime('20261126220000 +0100'), Date.UTC(2026, 10, 26, 21));
  assert.equal(parseXmltvTime('20261126220000 -0530'), Date.UTC(2026, 10, 27, 3, 30));
  assert.equal(parseXmltvTime('202611262200'), Date.UTC(2026, 10, 26, 22));
  assert.ok(Number.isNaN(parseXmltvTime('garbage')));
});

test('decodeEntities', () => {
  assert.equal(decodeEntities('A &amp; B &#x41; &#66; &quot;q&quot;'), 'A & B A B "q"');
});

test('streaming parser survives arbitrary chunk boundaries', () => {
  for (const size of [1, 7, 33, 1000]) {
    const got = [];
    const parser = createXmltvParser((p) => got.push(p));
    for (let i = 0; i < SAMPLE.length; i += size) parser.push(SAMPLE.slice(i, i + size));
    assert.equal(parser.end(), 3, `chunk size ${size}`);
    assert.equal(got[0].title, 'News & Weather');
    assert.equal(got[0].desc, 'Headlines <b>tonight</b>');
    assert.equal(got[1].title, 'Drama – Part 2');
  }
});

test('collector filters wanted channels + window, case-insensitive', () => {
  const from = Date.UTC(2026, 10, 26, 19);
  const to = Date.UTC(2026, 10, 27, 0);
  const col = createEpgCollector({ from, to, wanted: new Set(['bbc1.uk']) });
  const parser = createXmltvParser(col.onProgramme);
  parser.push(SAMPLE);
  parser.end();
  const { index, kept } = col.finish();
  assert.equal(kept, 2);
  assert.deepEqual(Object.keys(index), ['bbc1.uk']);

  const at = Date.UTC(2026, 10, 26, 20, 30);
  const nn = nowNext(index['bbc1.uk'], at);
  assert.equal(nn.now.title, 'News & Weather');
  assert.equal(nn.next.title, 'Drama – Part 2');
  assert.equal(nowNext(index['bbc1.uk'], Date.UTC(2026, 10, 26, 23)).now, null);
  assert.equal(range(index['bbc1.uk'], at, 5).length, 2);
});

test('parser handles a large synthetic feed quickly', () => {
  const blocks = [];
  for (let c = 0; c < 2000; c++)
    for (let h = 0; h < 24; h++)
      blocks.push(
        `<programme start="20261126${String(h).padStart(2, '0')}0000 +0000" stop="20261126${String(h).padStart(2, '0')}5900 +0000" channel="ch${c}"><title>Show ${h}</title><desc>Description text for show ${h} on channel ${c}</desc></programme>`
      );
  const xml = `<tv>${blocks.join('\n')}</tv>`;
  const t0 = performance.now();
  let n = 0;
  const parser = createXmltvParser(() => n++);
  for (let i = 0; i < xml.length; i += 65536) parser.push(xml.slice(i, i + 65536));
  parser.end();
  const ms = performance.now() - t0;
  assert.equal(n, 48000);
  console.log(`  parsed 48k programmes (${(xml.length / 1048576).toFixed(1)} MB) in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 3000);
});
