"""Test-only fixture: a real MCP stdio client, never a database writer."""
import sys, subprocess, hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'crates/mcp/tests/harness'))
from raw_client import Client, GATEWAY
profile,repo=map(Path,sys.argv[1:3])
p=subprocess.Popen([str(GATEWAY),'--profile',str(profile),'--repo',str(repo),'--grant-file',str(profile/('test-'+hashlib.sha256(str(repo).encode()).hexdigest()+'.json'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try:
 c=Client(p);c.request('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'browser-fixture','version':'1'}});c.request('notifications/initialized',notification=True)
 guide=c.tool('integration_guide',{});scope={k:guide[k] for k in ('repo_id','worktree_id')}
 ctx={**scope,'task':'Explain wallet default','paths':['Code.cs','Readme.md','Large.cs'],'budget_chars':2000}
 before=c.tool('context_get',ctx);s=c.tool('session_open',{**scope,'task':'Explain wallet default','actor':'browser fixture','expected_generation':before['generation']},True)
 source=b'public sealed class Wallet {\n    public int Balance = 75;\n}\n'
 (repo/'Code.cs').write_bytes(source)
 after=c.tool('context_get',ctx);capture=c.tool('snapshot_capture',{'session_id':s['session_id'],'paths':['Code.cs','Readme.md','Large.cs'],'expected_generation':after['generation']},True)
 decision={'session_id':s['session_id'],'snapshot_id':capture['snapshot_id'],'summary':'Начальный баланс 75','behavior':'Новый кошелёк содержит 75 единиц.','rationale':'Тестовый сценарий требует новый начальный баланс.','constraints':[],'alternatives':[],'source':'agent_reported','anchors':[{'comparison_id':capture['comparison']['id'],'snapshot_id':capture['snapshot_id'],'path':'Code.cs','side':'new','start_line':2,'end_line':2,'content_hash':hashlib.sha256(source.splitlines(keepends=True)[1]).hexdigest()}]}
 d=c.tool('decision_record',{'decision':decision},True)
 c.tool('evidence_record',{'session_id':s['session_id'],'snapshot_id':capture['snapshot_id'],'decision_ids':[d['decision_id']],'check':'Fixture bytes','status':'passed','environment':'Python MCP fixture','summary':'Проверены байты тестового файла, не выполнение C#.','source':'agent_reported'},True)
 deep=(repo/'Large.cs').read_bytes().splitlines(keepends=True)[1499]
 c.tool('decision_record',{'decision':{**decision,'summary':'Deep recorded block','anchors':[{'comparison_id':capture['comparison']['id'],'snapshot_id':capture['snapshot_id'],'path':'Large.cs','side':'new','start_line':1500,'end_line':1500,'content_hash':hashlib.sha256(deep).hexdigest()}]}},True)
 c.tool('session_close',{'session_id':s['session_id'],'final_snapshot_id':capture['snapshot_id'],'outcome':'completed','summary':'Fixture ready','unresolved':['C# execution not tested']},True)
 print(json.dumps(d))
finally:p.kill();p.wait(timeout=5)
