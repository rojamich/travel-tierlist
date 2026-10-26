import test from 'node:test';
import assert from 'node:assert/strict';
import { total,tierFor,emptyProfile,cleanMeta,cleanProfile,migrateCountry,parseBackup,exportBackup,rating,rankingQueue,selectCountries,safeUrl } from '../src/model.js';
const scores=value=>({wonder:value,things:value,food:value,transportation:value,safety:value});
const country=(name='Japan')=>migrateCountry({id:name.toLowerCase(),name,status:'visited',profiles:{mike:{scores:scores(4)},jen:{scores:scores(5)}}});

test('totals require all five valid whole-number scores',()=>{
  assert.equal(total(scores(4)),20);assert.equal(total({...scores(4),food:null}),null);
  assert.equal(total(scores(0)),null);assert.equal(total(scores(6)),null);assert.equal(total(scores(1.5)),null);
});
test('tier boundaries are exact and empty scores are unranked',()=>{
  for(const [score,tier] of [[null,'unranked'],[5,'D'],[14,'C'],[17,'B'],[20,'A'],[23,'S'],[22.5,'A']])assert.equal(tierFor(score),tier);
});
test('legacy visited and planning scores migrate to separate phases',()=>{
  assert.equal(total(country().profiles.mike.experienced.scores),20);
  const planning=migrateCountry({...country(),status:'planning',profiles:{mike:{scores:scores(3)}}});
  assert.equal(total(planning.profiles.mike.expected.scores),15);assert.equal(total(planning.profiles.mike.experienced.scores),null);
});
test('imported totals without component scores are preserved',()=>{
  const c=migrateCountry({id:'japan',name:'Japan',status:'visited',profiles:{mike:{scoreTotal:21,notes:'Keep me'}}});
  assert.equal(rating(c).score,21);assert.equal(c.profiles.mike.notes,'Keep me');
  assert.equal(rating(parseBackup(exportBackup([c]))[0]).score,21);
});
test('average labels count one and two raters without treating missing as zero',()=>{
  const c=country();assert.equal(rating(c).score,22.5);assert.equal(rating(c).count,2);
  c.profiles.jen=emptyProfile();assert.equal(rating(c).score,20);assert.equal(rating(c).count,1);
});
test('expected and experienced ratings never overwrite one another',()=>{
  const c=country();c.profiles.mike.expected={scores:scores(1)};
  assert.equal(rating(c,'mike','experienced').score,20);assert.equal(rating(c,'mike','expected').score,5);
});
test('neither-rated countries appear in both rating queues',()=>{
  const c=country();c.profiles={mike:emptyProfile(),jen:emptyProfile()};
  const q=rankingQueue([c]);assert.equal(q.mike.length,1);assert.equal(q.jen.length,1);assert.equal(q.neither.length,1);
});
test('custom destinations and structured budgets survive backup round trips',()=>{
  const c=migrateCountry({name:'Antarctica',id:'antarctica',custom:true,budget:{amount:12000,currency:'USD',basis:'couple',days:14}});
  const copy=parseBackup(JSON.stringify(exportBackup([c])))[0];assert.deepEqual(copy,c);
});
test('invalid imports and invalid score ranges are rejected',()=>{
  assert.throws(()=>parseBackup('{}'));assert.throws(()=>parseBackup([null]));assert.throws(()=>parseBackup([{name:'Japan',scores:scores(9)}]));
  assert.throws(()=>parseBackup([country(),country()]));assert.throws(()=>cleanMeta({name:'Japan',budget:{amount:-5}}));
});
test('unsafe media links are stripped and HTTPS links are retained',()=>{
  assert.equal(safeUrl('javascript:alert(1)'), '');assert.equal(safeUrl('http://insecure.example/photo'), '');
  assert.equal(safeUrl('https://example.com/photo'),'https://example.com/photo');
});
test('disagreement sorting and photo-text search work',()=>{
  const japan=country(),italy=country('Italy');italy.profiles.mike.experienced.scores=scores(1);
  const filters={query:'',view:'average',phase:'auto',status:'all',tier:'all',sort:'disagreement'};
  assert.equal(selectCountries([japan,italy],filters)[0].name,'Italy');
  japan.images=[{src:'https://example.com/x',alt:'Mount Fuji',photographer:'A'}];
  assert.equal(selectCountries([japan,italy],{...filters,query:'fuji'}).length,1);
});
