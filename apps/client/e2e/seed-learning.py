"""Populate educational fixtures through the real MCP protocol, never through SQLite."""
import sys, subprocess, json, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'crates/mcp/tests/harness'))
from raw_client import Client,GATEWAY
profile,repo=map(Path,sys.argv[1:3]);
for file in ['Dash.cs','ResourceWallet.cs']:(repo/file).write_bytes((ROOT/'packages/fixtures'/file).read_bytes())
p=subprocess.Popen([str(GATEWAY),'--profile',str(profile),'--repo',str(repo),'--grant-file',str(profile/f'learning-{uuid.uuid4()}.json')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try:
 c=Client(p);c.request('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'learning-fixture','version':'1'}});c.request('notifications/initialized',notification=True)
 guide=c.tool('integration_guide',{});scope={k:guide[k] for k in ('repo_id','worktree_id')};ctx={**scope,'task':'Explain dash control flow','paths':['Dash.cs','ResourceWallet.cs'],'budget_chars':8000};before=c.tool('context_get',ctx);s=c.tool('session_open',{**scope,'task':'Explain dash control flow','actor':'learning fixture','expected_generation':before['generation']},True);capture=c.tool('snapshot_capture',{'session_id':s['session_id'],'paths':['Dash.cs','ResourceWallet.cs'],'expected_generation':before['generation']},True)
 fixtures=json.loads((ROOT/'packages/fixtures/trace-v1.json').read_text());ids={}
 for name,trace in fixtures.items():
  trace['snapshot_id']=capture['snapshot_id'];ids[name]=c.tool('trace_record',{'session_id':s['session_id'],'trace':trace},True)['artifact_id']
 location=fixtures['success']['steps'][0]['location'];helper=json.loads(json.dumps(location));helper['path']={'display':'ResourceWallet.cs','raw_base64':'UmVzb3VyY2VXYWxsZXQuY3M=','encoding':'unix_bytes'};helper['line']=6
 diagram={'snapshot_id':capture['snapshot_id'],'title':'Dash dependencies','assumptions':['Agent-reported code relationships; external caller is inferred.'],'nodes':[{'id':'input','label':'Input system','location':None},{'id':'dash','label':'TryDash','location':location},{'id':'normalize','label':'TrySpend','location':helper}],'edges':[{'id':'e1','from':'input','to':'dash','label':'requests dash','certainty':'Inferred'},{'id':'e2','from':'dash','to':'normalize','label':'spends resource','certainty':'Reported'}]}
 ids['diagram']=c.tool('diagram_record',{'session_id':s['session_id'],'diagram':diagram},True)['artifact_id'];ids['snapshot']=capture['snapshot_id'];c.tool('session_close',{'session_id':s['session_id'],'final_snapshot_id':capture['snapshot_id'],'outcome':'completed','summary':'Educational scenarios recorded','unresolved':['Not observed execution']},True);print(json.dumps(ids))
finally:p.kill();p.wait(timeout=5)
