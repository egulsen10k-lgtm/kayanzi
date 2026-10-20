import test from 'node:test';
import assert from 'node:assert/strict';
import {assetUrl} from '../src/resource-urls.js';
test('runtime map assets respect a GitHub Pages repository prefix',()=>{
  assert.equal(assetUrl('/data/akanzi-route.json','/kayanzi/'),'/kayanzi/data/akanzi-route.json');
  assert.equal(assetUrl('data/munich.json','/kayanzi'),'/kayanzi/data/munich.json');
  assert.equal(assetUrl('data/munich.json','/'),'/data/munich.json');
});
