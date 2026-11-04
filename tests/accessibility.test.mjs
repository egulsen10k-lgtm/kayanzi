import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const visualizer=await readFile(new URL('../src/visualizer.js',import.meta.url),'utf8');

function openingTag(id){return html.match(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`,'i'))?.[0]??'';}

test('pause and controller controls expose accessible names and live dialog status',()=>{
  assert.match(openingTag('pause-toggle'),/aria-label=/i);
  assert.match(openingTag('pause-overlay'),/role="dialog"/i);
  assert.match(openingTag('pause-overlay'),/aria-modal="true"/i);
  assert.match(openingTag('pause-overlay'),/aria-labelledby="pause-title"/i);
  assert.match(openingTag('controller-status'),/role="status"/i);
  assert.match(openingTag('controller-status'),/aria-live="polite"/i);
  for(const id of ['pause-resume','pause-reset-road','pause-exit-menu'])assert.ok(openingTag(id),`missing ${id}`);
});

test('icon-only map, fullscreen, touch, and close buttons have aria labels',()=>{
  for(const id of ['fullscreen-toggle','minimap-zoom-in','minimap-zoom-out','mobile-drive-menu-close','settings-close','drive-dynamics-close']){
    assert.match(openingTag(id),/aria-label=/i,`${id} needs an accessible name`);
  }
  for(const selector of ['button:focus-visible','input:focus-visible','select:focus-visible'])assert.ok(html.includes(selector));
  for(const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)){
    const attributes=match[1],text=match[2].replace(/<[^>]*>/g,'').replace(/&[^;]+;/g,' ').trim();
    assert.ok(/aria-label|aria-labelledby/i.test(attributes)||/[\p{L}\p{N}]/u.test(text),`button lacks an accessible name: ${text||attributes}`);
  }
});

test('noncritical dynamic notices are polite live regions and reduced motion is supported',()=>{
  for(const token of ["driftToast.setAttribute('role','status')","boardToast.setAttribute('aria-live','polite')","bubble.setAttribute('aria-live','polite')","ticketChip.setAttribute('role','status')"]){assert.ok(main.includes(token),`missing ${token}`);}
  assert.ok(main.includes("speedCamBanner.setAttribute('role','alert')"));
  assert.doesNotMatch(html,/id="fuel-warning-banner"[^>]*aria-live="assertive"/i);
  assert.match(html,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.ok(visualizer.includes("prefers-reduced-motion: reduce")||visualizer.includes('this.reducedMotion'));
});
