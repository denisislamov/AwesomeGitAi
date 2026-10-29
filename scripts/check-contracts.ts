import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';
const r=spawnSync('scripts/cargo-local.sh',['run','--quiet','-p','agai-protocol','--bin','export'],{encoding:'utf8'});
if(r.status!==0){process.stderr.write(r.stderr);process.exit(1)}
const path='packages/api/src/generated.ts';
if(process.argv.includes('--write'))writeFileSync(path,r.stdout);
else if(readFileSync(path,'utf8')!==r.stdout){console.error('Generated protocol drift. Run pnpm contracts:generate');process.exit(1)}
console.log('Protocol types match Rust DTOs');
