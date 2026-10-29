// Creates a disposable repository only; never operates on an existing checkout.
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'agai-bench-'));
function git(args:string[],input?:string){const r=spawnSync('git',['-C',root,...args],{input,encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw Error(r.stderr);return r.stdout;}
git(['init','-q','--initial-branch=main']);
let stream='blob\nmark :1\ndata 17\nclass Example {}\n\n';
for(let c=0;c<100000;c++){
 stream+=`commit refs/heads/main\ncommitter Fixture <fixture@example.invalid> ${1700000000+c} +0000\ndata ${String(c).length}\n${c}\n`;
 if(c===0){for(let f=0;f<10000;f++)stream+=`M 100644 :1 src/File${f}.cs\n`;}
 stream+='\n';
}
git(['fast-import','--quiet'],stream);git(['reset','--hard','HEAD']);
for(let f=0;f<1000;f++)writeFileSync(join(root,`src/File${f}.cs`),'class Changed {}\n');
writeFileSync(join(root,'large.txt'),'x'.repeat(2*1024*1024+1));
const commits=Number(git(['rev-list','--count','HEAD']).trim());
const files=git(['ls-files','-z']).split('\0').filter(Boolean).length;
const changed=git(['diff','--name-only','-z']).split('\0').filter(Boolean).length;
if(commits!==100000||files!==10000||changed!==1000)throw Error('Invalid fixture');
const timings=[];
for(let i=0;i<3;i++){const start=performance.now();git(['log','-200','--format=%H %P %s']);timings.push(performance.now()-start);}
console.log(JSON.stringify({root,commits,trackedFiles:files,changedFiles:changed,largeFileBytes:2097153,gitLog200Ms:timings,measurement:'First and two subsequent Git CLI reads; not UI render or controlled cold-cache benchmark'},null,2));
