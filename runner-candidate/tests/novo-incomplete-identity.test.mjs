import test from 'node:test';
import assert from 'node:assert/strict';
import {novoIncompleteDetailIsBound} from '../src/crawler/novoChinaQuality.ts';
import {detail} from './novo-synthetic-pages.ts';

test('incomplete native details require a unique portal and matching canonical list identity',()=>{
 const url=detail(2),root='<div id="careerjobdisplay"><h1></h1></div>',link=href=>`<link rel="canonical" href="${href}">`;
 assert(novoIncompleteDetailIsBound(link(url)+root,url));
 assert(novoIncompleteDetailIsBound(`<link rel="alternate canonical" href="${url}">`+root,url));
 assert(novoIncompleteDetailIsBound('<base href="https://other.invalid/">'+link(url)+root,url));
 assert(novoIncompleteDetailIsBound('<base href="http://[">'+link(url)+root,url));
 assert(novoIncompleteDetailIsBound('<base href="/content/nncorp/cn/zh_cn/careers/find-a-job/">'+link(new URL(url).pathname.split('/').pop())+root,url));
 assert.equal(novoIncompleteDetailIsBound('<base href="https://other.invalid/">'+link(new URL(url).pathname)+root,url),false);
 assert.equal(novoIncompleteDetailIsBound(link(url)+`<link rel="alternate canonical" href="${detail(1)}">`+root,url),false);
 for(const html of [root,link('')+root,link(' ')+root,link(detail(1))+root,link('https://other.invalid/job')+root,link(url),link(url)+link(url)+root,link(url)+'<link rel="canonical">'+root,link(url)+root+root]){
  assert.equal(novoIncompleteDetailIsBound(html,url),false);
 }
});
