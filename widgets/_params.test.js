require('./_params.js');               // IIFE hängt Params an globalThis
const { values, buildUrl } = globalThis.Params;
const schema = [{key:'port',default:'9210'}, {key:'scope',default:'session'}];
let v = values(schema, '?scope=all');
if (!(v.port === '9210' && v.scope === 'all')) throw new Error('values defaults/override falsch: ' + JSON.stringify(v));
let u = buildUrl('http://x', schema, {port:'9210', scope:'all'});
if (u !== 'http://x?scope=all') throw new Error('buildUrl: ' + u);
let u2 = buildUrl('http://x', schema, {port:'9210', scope:'session'});
if (u2 !== 'http://x') throw new Error('buildUrl nackt: ' + u2);
console.log('ok');
