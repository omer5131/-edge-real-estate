import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshnessWeight,weightedDealScore,bayesianAdjust,weightedAreaScore,confidenceLevel,percentileRank
} from '../.server-test/server/areaScoring.js';

test('freshness decays and excludes stale listings',()=>{
  assert.equal(freshnessWeight(1),1);
  assert.equal(freshnessWeight(10),.9);
  assert.equal(freshnessWeight(25),.75);
  assert.equal(freshnessWeight(50),.5);
  assert.equal(freshnessWeight(61),0);
});

test('deal score uses freshness and confidence weights',()=>{
 const result=weightedDealScore([
  {score:90,ageDays:2,confidenceWeight:1},
  {score:50,ageDays:50,confidenceWeight:.5},
  {score:100,ageDays:90,confidenceWeight:1}
 ]);
 assert.equal(result.count,2);
 assert.ok(result.score>80&&result.score<90);
});

test('bayesian shrinkage protects tiny samples',()=>{
 assert.equal(bayesianAdjust(100,0,60,5),60);
 assert.ok(bayesianAdjust(100,1,60,5)<70);
 assert.ok(bayesianAdjust(100,20,60,5)>90);
});

test('area score reweights only when coverage is sufficient',()=>{
 const weights={deal:25,market:15,renewal:20,demographics:15,rental:10,infrastructure:10,supply:5};
 const insufficient=weightedAreaScore({deal:90,market:70},weights,60);
 assert.equal(insufficient.score,null);
 const enough=weightedAreaScore({deal:90,market:70,renewal:80,demographics:60},weights,60);
 assert.ok(enough.score!==null);
 assert.equal(enough.coveragePct,75);
});

test('confidence and percentile are deterministic',()=>{
 assert.equal(confidenceLevel(85,{high:80,medium:60,low:35}),'high');
 assert.equal(confidenceLevel(20,{high:80,medium:60,low:35}),'insufficient');
 assert.equal(percentileRank([1,2,3,4],3),62.5);
});
