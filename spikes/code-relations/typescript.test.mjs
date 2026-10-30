import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from './typescript.mjs';
test('TypeScript resolves references and distinguishes writes from reads',()=>{
 const code='class Wallet { amount = 30; spend(n: number) { this.amount -= n; return this.amount; } }\nconst wallet = new Wallet(); wallet.spend(20);';
 const result=analyze(code,code.indexOf('amount'));
 assert.equal(result.version,'6.0.3');assert.equal(result.references.length,3);
 assert.equal(result.references.filter(r=>!r.isWriteAccess).length,1);
 assert.equal(result.references.filter(r=>r.isWriteAccess).length,2);
});
