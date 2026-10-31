import test from 'node:test';
import assert from 'node:assert/strict';
import {novoApplicationStatus} from '../src/crawler/novoChinaQuality.ts';
const city='Liangshan Yi Autonomous Prefecture',url='https://careers.novonordisk.com/job/synthetic/1234567890/';
const html=location=>`<div class="jobDisplay"><div class="job"><h1 data-careersite-propertyid="title">Synthetic role</h1><div class="jobGeoLocation">${location}</div></div><a class="apply" href="/talentcommunity/apply/1234567890/?locale=en_GB">Apply now</a></div>`;
test('an official truncated city in the same mainland province stays active with uncertain city',()=>{
  assert.deepEqual(novoApplicationStatus(html('Liangshan Yi Autonomous Prefec, Sichuan, CN'),url,city,'Sichuan'),{status:'ACTIVE',title:'Synthetic role',cityUncertain:true});
  assert.deepEqual(novoApplicationStatus(html(`${city}, Sichuan, CN`),url,city,'Sichuan'),{status:'ACTIVE',title:'Synthetic role'});
});
test('an uncertain city needs the original mainland province and China country, and cannot weaken native apply identity',()=>{
  for(const location of ['Liangshan Yi Autonomous Prefec, Yunnan, CN','Liangshan Yi Autonomous Prefec, Sichuan, SG','Hong Kong, Sichuan, CN'])assert.equal(novoApplicationStatus(html(location),url,city,'Sichuan'),undefined);
  assert.equal(novoApplicationStatus(html('Liangshan Yi Autonomous Prefec, Sichuan, CN'),url,city),undefined);
  assert.equal(novoApplicationStatus(html('Liangshan Yi Autonomous Prefec, Sichuan, CN').replace('apply/1234567890','apply/999'),url,city,'Sichuan'),undefined);
});
