"""Validate the actual macOS bundle's host and semantic runtimes on captured files."""
import base64
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'apps/client/src-tauri/target/debug/bundle/macos/AwesomeGitAi.app/Contents/Resources/bin'
os.environ['AGAI_HOST_BIN'] = str(BUNDLE / 'agai-host')
sys.path.insert(0, str(ROOT / 'crates/mcp/tests/harness'))
from raw_client import desktop, wait_until, HOST

with tempfile.TemporaryDirectory(prefix='agai-relations-bundle-', dir='/tmp') as directory:
    profile = Path(directory) / 'profile'
    repo = Path(directory) / 'repo'
    repo.mkdir()
    sources = {
        'A.cs': 'public class A { public int Spend(int cost) { return cost; } }\n',
        'B.cs': 'class B { int Run() { return new A().Spend(2); } }\n',
        'a.ts': 'export const spend = (cost: number) => cost;\n',
        'b.ts': 'import {spend} from "./a"; const result = spend(2);\n',
        'a.py': 'def spend(cost):\n    return cost\n',
        'b.py': 'from a import spend\nresult = spend(2)\n',
    }
    for name, text in sources.items():
        (repo / name).write_text(text)
    subprocess.run(['git', 'init', '-q', str(repo)], check=True)
    host = subprocess.Popen([str(HOST), str(profile)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        wait_until(lambda: (profile / 'host.sock').exists())
        state = desktop(profile, {'kind': 'OpenRepository', 'path': str(repo)})['state']
        scope = {k: state[k] for k in ('repo_id', 'worktree_id')}
        for name, target, symbol in [('A.cs', 'B.cs', 'Spend'), ('a.ts', 'b.ts', 'spend'), ('a.py', 'b.py', 'spend')]:
            path = {'display': name, 'raw_base64': base64.b64encode(name.encode()).decode(), 'encoding': 'unix_bytes'}
            comparison = desktop(profile, {'kind': 'CompareFile', 'scope': scope, 'path': path, 'base': 'Head', 'target': 'Worktree'})
            report = desktop(profile, {'kind': 'CodeRelations', 'scope': scope, 'snapshot_id': comparison['target']['id'], 'path': path})['report']
            assert report['status'] == 'Partial', report['message']
            matches = [s for s in report['symbols'] if s['name'] == symbol and s['path']['display'] == name]
            reference = next(r for s in matches for r in s['references'] if r['path']['display'] == target and r['kind'] == 'Call')
            revision = {'Snapshot': {'id': report['snapshot_id']}}
            linked = desktop(profile, {'kind': 'CompareFile', 'scope': scope, 'path': reference['path'], 'base': revision, 'target': revision})
            assert linked['target']['id'] == report['snapshot_id']
            print(f'{name}: {report["adapter"]}, cross-file Call and pinned navigation PASS')
    finally:
        host.terminate()
        try:
            host.wait(timeout=5)
        except subprocess.TimeoutExpired:
            host.kill()
            host.wait()
