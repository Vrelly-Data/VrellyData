// Live Feed filter rules (no DB). Run with: deno run --allow-net=none --allow-read test_live_feed_filters.mjs
import {
  cardMatches, categoryOf, dateBounds, DEFAULT_CATEGORIES, filtersFromParams, filtersToParams, hasCardFilters, platformOfEvent,
} from './src/lib/liveFeedFilters.ts';

let failed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${msg}\n  expected ${e}\n  actual   ${a}`);
    failed++;
  }
}

// platform: metadata.provider, else the writer; a classification alone is unknown
eq(platformOfEvent('poll_reply_inbox', {}), 'reply_io', 'poll_reply_inbox');
eq(platformOfEvent('reply_webhook', null), 'reply_io', 'reply_webhook');
eq(platformOfEvent('smartlead_webhook', { provider: 'smartlead' }), 'smartlead', 'smartlead');
eq(platformOfEvent('heyreach_webhook', {}), 'heyreach', 'heyreach');
eq(platformOfEvent('classify_reply', {}), null, 'classification alone');
eq(platformOfEvent('anything', { provider: 'heyreach' }), 'heyreach', 'provider wins');

// categories: Neutral = needs more info, referral, unknown, unclassified
eq(['interested', 'not_interested', 'out_of_office', 'bounce', 'needs_more_info', 'referral', 'unknown', null].map(categoryOf),
  ['interested', 'not_interested', 'out_of_office', 'bounce', 'neutral', 'neutral', 'neutral', 'neutral'], 'categoryOf');

// URL: empty → defaults (Interested + Neutral); 'all' → no category filter; junk ignored
const empty = filtersFromParams(new URLSearchParams(''));
eq(empty, { team: null, platforms: [], categories: DEFAULT_CATEGORIES, channel: null, from: null, to: null }, 'defaults');
eq(filtersFromParams(new URLSearchParams('lf_cat=all')).categories, [], 'all categories');
const parsed = filtersFromParams(new URLSearchParams('lf_team=t1&lf_platform=heyreach,bogus,smartlead&lf_cat=not_interested&lf_channel=linkedin&lf_from=2026-10-01&lf_to=nope&tab=live'));
eq(parsed, { team: 't1', platforms: ['heyreach', 'smartlead'], categories: ['not_interested'], channel: 'linkedin', from: '2026-10-01', to: null }, 'parse');

// round trip keeps other params; the default category set is not written
const back = filtersToParams(parsed, new URLSearchParams('tab=live&lf_to=x'));
eq(back.get('tab'), 'live', 'other params kept');
eq(back.get('lf_to'), null, 'cleared value removed');
eq(filtersFromParams(back), parsed, 'round trip');
eq(filtersToParams(empty, new URLSearchParams()).toString(), '', 'defaults → clean URL');
eq(filtersToParams({ ...empty, categories: [] }, new URLSearchParams()).get('lf_cat'), 'all', 'no categories → all');

// card filter
const f = { ...empty, platforms: ['smartlead'] };
eq(cardMatches({ platform: 'smartlead', intent: 'interested' }, f), true, 'match');
eq(cardMatches({ platform: 'smartlead', intent: 'not_interested' }, f), false, 'not interested hidden by default');
eq(cardMatches({ platform: null, intent: 'interested' }, f), false, 'unknown platform hidden when filtering by platform');
eq(cardMatches({ platform: null, intent: null }, { ...empty }), true, 'unclassified counts as neutral');
eq(hasCardFilters({ ...empty, categories: [] }), false, 'no card filters');

// dates: inclusive local days
const b = dateBounds({ from: '2026-10-01', to: '2026-10-03' });
eq(new Date(b.gte).getDate(), 1, 'from day');
eq(new Date(b.lt).getDate(), 4, 'to is inclusive (exclusive bound the next day)');
eq(dateBounds({ from: null, to: null }), { gte: null, lt: null }, 'no dates');

if (failed) {
  console.error(`${failed} failed`);
  Deno.exit(1);
}
console.log('live feed filter tests: all passed');
