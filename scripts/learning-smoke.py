"""Exercise the bundled host + MCP, using only a disposable profile/repository."""
import json, os, subprocess, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BUNDLE=ROOT/'apps/client/src-tauri/target/debug/bundle/macos/AwesomeGitAi.app/Contents/Resources/bin'
os.environ['AGAI_HOST_BIN']=str(BUNDLE/'agai-host');os.environ['AGAI_MCP_BIN']=str(BUNDLE/'agai-mcp')
sys.path.insert(0,str(ROOT/'crates/mcp/tests/harness'))
from raw_client import desktop,wait_until,HOST
with tempfile.TemporaryDirectory(prefix='agai-learning-', dir='/tmp') as d:
    base=Path(d);profile=base/'profile';repo=base/'repo';repo.mkdir()
    subprocess.run(['git','init','-q',str(repo)],check=True)
    host=subprocess.Popen([str(HOST),str(profile)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        wait_until(lambda:(profile/'host.sock').exists())
        state=desktop(profile,{'kind':'OpenRepository','path':str(repo)})['state']
        scope={k:state[k] for k in ['repo_id','worktree_id']}
        result=subprocess.run([sys.executable,str(ROOT/'apps/client/e2e/seed-learning.py'),str(profile),str(repo)],capture_output=True,text=True,check=True)
        ids=json.loads(result.stdout)
        items=desktop(profile,{'kind':'LearningList','scope':scope})['items'];assert len(items)==3
        for kind,name in [('trace','success'),('trace','failure'),('diagram','diagram')]:
            record=desktop(profile,{'kind':'LearningGet','scope':scope,'id':ids[name],'artifact_kind':kind})['record']
            assert record['item']['snapshot_id']==ids['snapshot']
            if kind=='trace':assert not record['trace']['steps'][-1]['frames'] and record['trace']['final_values']
        print('Bundled macOS host + MCP: two-file trace success/failure, final values and diagram round trip PASS')
    finally:
        host.terminate()
        try:host.wait(timeout=5)
        except subprocess.TimeoutExpired:host.kill();host.wait()
