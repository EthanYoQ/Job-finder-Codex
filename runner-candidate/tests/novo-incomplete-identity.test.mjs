import test from 'node:test';
import assert from 'node:assert/strict';
import {novoIncompleteDetailIsBound} from '../src/crawler/novoChinaQuality.ts';
import {detail} from './novo-synthetic-pages.ts';

test('incomplete native details require a unique portal and matching canonical list identity',()=>{
 const url=detail(2),root='<div id="careerjobdisplay"><h1></h1></div>',link=href=>`<link rel="canonical" href="${href}">`;
 assert(novoIncompleteDetailIsBound(link(url)+root,url));
 for(const html of [root,link('')+root,link(' ')+root,link(detail(1))+root,link('https://other.invalid/job')+root,link(url),link(url)+link(url)+root,link(url)+'<link rel="canonical">'+root,link(url)+root+root]){
  assert.equal(novoIncompleteDetailIsBound(html,url),false);
 }
});
