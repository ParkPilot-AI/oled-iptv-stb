import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, normChannelName, buildLogoMatcher, pickLogos, pickTmdbLogo } from '../electron/artmatch.js';

test('cleanTitle strips provider decorations', () => {
  assert.deepEqual(cleanTitle('EN - The Matrix (1999) [4K]'), { title: 'The Matrix', year: '1999' });
  assert.deepEqual(cleanTitle('|UK| Peaky Blinders'), { title: 'Peaky Blinders', year: '' });
  assert.deepEqual(cleanTitle('[MULTI] Dune: Part Two 2024 HDR'), { title: 'Dune: Part Two', year: '2024' });
  assert.deepEqual(cleanTitle('Blade.Runner.2049.2017'), { title: 'Blade Runner 2049', year: '2017' });
});

test('normChannelName', () => {
  assert.deepEqual(normChannelName('UK: BBC One HD'), { name: 'bbcone', country: 'GB' });
  assert.deepEqual(normChannelName('|US| CNN FHD'), { name: 'cnn', country: 'US' });
  assert.equal(normChannelName('Sky Sports+ (backup)').name, 'skysportsplus');
  assert.equal(normChannelName('Arte 4K').name, 'arte');
});

const channels = [
  { id: 'BBCOne.uk', name: 'BBC One', alt_names: ['BBC 1'], country: 'GB' },
  { id: 'CNN.us', name: 'CNN', country: 'US' },
  { id: 'CNNInternational.us', name: 'CNN International', country: 'US' },
  { id: 'Arte.fr', name: 'Arte', country: 'FR' },
  { id: 'Arte.de', name: 'Arte', country: 'DE' },
  { id: 'Closed.uk', name: 'Gone TV', country: 'GB', closed: '2020-01-01' },
];
const logos = [
  { channel: 'BBCOne.uk', feed: null, in_use: true, format: 'PNG', width: 512, url: 'https://x/bbc1.png' },
  { channel: 'BBCOne.uk', feed: 'HD', in_use: true, format: 'PNG', width: 1024, url: 'https://x/bbc1-hd-feed.png' },
  { channel: 'BBCOne.uk', feed: null, in_use: false, format: 'PNG', width: 900, url: 'https://x/bbc1-old.png' },
  { channel: 'CNN.us', feed: null, in_use: true, format: 'SVG', width: 300, url: 'https://x/cnn.svg' },
  { channel: 'Arte.fr', feed: null, in_use: true, format: 'PNG', width: 300, url: 'https://x/arte-fr.png' },
  { channel: 'Arte.de', feed: null, in_use: true, format: 'PNG', width: 300, url: 'https://x/arte-de.png' },
  { channel: 'Closed.uk', feed: null, in_use: true, format: 'PNG', width: 300, url: 'https://x/gone.png' },
];

test('pickLogos prefers current channel-level logos', () => {
  assert.equal(pickLogos(logos).get('BBCOne.uk').url, 'https://x/bbc1.png');
});

test('logo matcher: epg id, names, alt names, country hints', () => {
  const m = buildLogoMatcher(channels, logos);
  assert.equal(m({ name: 'whatever', epg: 'bbcone.uk' }), 'https://x/bbc1.png'); // epg id, case-insensitive
  assert.equal(m({ name: 'UK: BBC 1 FHD', epg: '' }), 'https://x/bbc1.png'); // alt name + prefix
  assert.equal(m({ name: 'US: CNN HD', epg: '' }), 'https://x/cnn.svg');
  assert.equal(m({ name: 'DE: Arte HD', epg: '' }), 'https://x/arte-de.png'); // country disambiguation
  assert.equal(m({ name: 'Arte', epg: 'arte.fr' }), 'https://x/arte-fr.png');
  assert.equal(m({ name: 'Arte', epg: '' }), 'https://x/arte-fr.png'); // ambiguous, no hint → first
  assert.equal(m({ name: 'Gone TV', epg: '' }), null); // closed channels skipped
  assert.equal(m({ name: 'Unknown Channel', epg: '' }), null);
});

test('pickTmdbLogo prefers English PNG with votes', () => {
  assert.equal(
    pickTmdbLogo([
      { file_path: '/a.svg', iso_639_1: 'en', vote_average: 9 },
      { file_path: '/b.png', iso_639_1: 'de', vote_average: 10 },
      { file_path: '/c.png', iso_639_1: 'en', vote_average: 5 },
      { file_path: '/d.png', iso_639_1: 'en', vote_average: 7 },
    ]),
    '/d.png'
  );
  assert.equal(pickTmdbLogo([]), null);
});

test('provider prefixes are stripped without eating real titles', async () => {
  const { cleanTitle } = await import('../electron/artmatch.js');
  const t = (s) => cleanTitle(s).title;
  assert.equal(t('4K-NF - Wednesday'), 'Wednesday');
  assert.equal(t('D+ | The Mandalorian'), 'The Mandalorian');
  assert.equal(t('EN|Oppenheimer (2023)'), 'Oppenheimer');
  assert.equal(t('NF: Squid Game'), 'Squid Game');
  assert.equal(t('9-1-1'), '9-1-1');
  assert.equal(t('X-Men: Days of Future Past'), 'X-Men: Days of Future Past');
  assert.equal(t('CSI: Vegas'), 'CSI: Vegas');
});

test('official logos: country-aware, +1 and alias handling', async () => {
  const { buildTvLogoMatcher } = await import('../electron/artmatch.js');
  const idx = {
    base: 'https://x/',
    folders: {
      'countries/united-kingdom': ['bbc-one-uk', 'channel-4-plus-uk', 'channel-4-uk', 'bbc-cbeebies-uk', 'channel-5-uk', 'espn-uk', 'sky-news-hz-uk'],
      'countries/united-states': ['espn-us'],
    },
  };
  const f = buildTvLogoMatcher(idx, 'GB');
  assert.equal(f({ name: 'UK: BBC One HD' }), 'https://x/countries/united-kingdom/bbc-one-uk.png');
  assert.equal(f({ name: 'UK| Channel 4 +1' }), 'https://x/countries/united-kingdom/channel-4-plus-uk.png');
  assert.equal(f({ name: 'UK: CBeebies' }), 'https://x/countries/united-kingdom/bbc-cbeebies-uk.png');
  assert.equal(f({ name: 'UK: 5' }), 'https://x/countries/united-kingdom/channel-5-uk.png');
  assert.equal(f({ name: 'US: ESPN' }), 'https://x/countries/united-states/espn-us.png');
  assert.equal(f({ name: 'ESPN' }), 'https://x/countries/united-kingdom/espn-uk.png'); // home country
  assert.equal(f({ name: 'UK: Sky News' }), 'https://x/countries/united-kingdom/sky-news-hz-uk.png');
  assert.equal(f({ name: 'Nothing Like It' }), null);
});

test('channel genres', async () => {
  const { classifyChannel: c } = await import('../electron/artmatch.js');
  assert.equal(c({ name: 'UK: Sky Sports Main Event', catName: 'UK | Sports', home: 'GB' }), 'sports');
  assert.equal(c({ name: 'UK: Something', catName: 'UK | Kids', home: 'GB' }), 'kids');
  assert.equal(c({ name: 'UK: CNN', catName: 'UK | General', home: 'GB' }), 'news');
  assert.equal(c({ name: 'UK: Dave', catName: 'UK | General', home: 'GB' }), 'entertainment');
  assert.equal(c({ name: 'FR: TF1', catName: 'France', home: 'GB' }), 'international');
  assert.equal(c({ name: 'US: AMC', catName: 'USA', home: 'GB' }), 'entertainment'); // English-language
  assert.equal(c({ name: 'Mystery', catName: 'Adult 18+', home: 'GB' }), 'adult');
  assert.equal(c({ name: 'Channel X', catName: 'Misc', iptvCats: ['documentary'], home: 'GB' }), 'documentaries');
});
