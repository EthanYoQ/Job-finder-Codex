import test from 'node:test';
import assert from 'node:assert/strict';
import {novoNativeDetailHasSubstantiveDescription as substantive} from '../src/crawler/novoChinaQuality.ts';

const detail=paragraph=>`<div id="careerjobdisplay"><h1>合成职位</h1><div class="job-display-details right-column"><p>${paragraph}</p></div></div>`;

test('short Chinese duties and concrete experience requirements need no length or unique-character quota',()=>{
  for(const paragraph of ['执行产品推广策略','医药或相关领域工作经验','5年以上医药领域销售经验','负责药品推广，负责产品推广']) {
    assert.equal(substantive(detail(paragraph)),true,paragraph);
  }
});

test('headings, placeholders, recruitment boilerplate and hidden duties remain insufficient',()=>{
  for(const paragraph of ['工作经验','学历','岗位职责 任职要求','na','*','TBD',
    'We commit to an inclusive recruitment process and equality of opportunity for all our job applicants.',
    '<span hidden>负责设计产品推广活动并执行市场方案</span>']) {
    assert.equal(substantive(detail(paragraph)),false,paragraph);
  }
});
