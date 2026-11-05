import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJnjCareersChinaCards} from '../src/crawler/jnjCareersChinaSourceFetch.ts';

function parse(location,countryScope) {
 const html=`<li class="PageList-items-item card-job" data-id="r-107981"><a href="/en/jobs/r-107981/synthetic-role/">Synthetic role</a><div class="PagePromo-category">Research</div><address class="PagePromo-location">${location}</address></li>`;
 const jobs=parseJnjCareersChinaCards(html,countryScope);
 assert.equal(jobs.length,1);assert.equal(jobs[0].locationRaw,location.replace(/\s+/gu,' ').trim());
 return jobs[0].cities;
}

test('JNJ mixed official locations retain only evidenced mainland city tags',()=>{
 for(const [raw,cities] of [
  ['Singapore / Beijing / Chiyoda',['北京']],
  ['Chiyoda / Beijing / Singapore',['北京']],
  ['Beijing /  / Singapore',['北京']],
  ['Beijing',['北京']],['北京 / Shanghai / Beijing',['北京','上海']],
  ['Singapore / Chizhou',['池州']],
  ['China / Unmapped location',['城市待核']],['Singapore / China',['城市待核']]
 ])assert.deepEqual(parse(raw,'China'),cities,raw);
});

test('JNJ pure foreign or unassigned locations do not acquire China city tags',()=>{
 for(const raw of ['Singapore','Chiyoda','Singapore / Chiyoda','Tokyo / Japan','Hong Kong','Unmapped location','Global'])
  assert.deepEqual(parse(raw,'China'),[],raw);
 assert.deepEqual(parse('Unmapped location',undefined),[]);
});
