#!/usr/bin/env python3
"""Independent raw JSON-RPC harness. Uses no MCP SDK or direct database writes."""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[4]
HOST = Path(os.environ.get('AGAI_HOST_BIN', ROOT / 'target/debug/agai-host'))
GATEWAY = Path(os.environ.get('AGAI_MCP_BIN', ROOT / 'target/debug/agai-mcp'))

def wait_until(test):
    for _ in range(200):
        if test():
            return
        time.sleep(.025)
    raise AssertionError('local service did not become ready')

def desktop(profile, request):
    body = json.dumps({'meta': {'schema_version': 1, 'request_id': str(uuid.uuid4()), 'idempotency_key': None}, 'desktop': request}).encode()
    with socket.socket(socket.AF_UNIX) as conn:
        conn.connect(str(profile / 'host.sock'))
        conn.sendall(struct.pack('>I', len(body)) + body)
        def read_exact(n):
            data = b''
            while len(data) < n:
                chunk = conn.recv(n - len(data))
                assert chunk, 'host closed frame'
                data += chunk
            return data
        size = struct.unpack('>I', read_exact(4))[0]
        assert size <= 16 * 1024 * 1024
        result = json.loads(read_exact(size))
        assert 'Ok' in result, result
        return result['Ok']

class Client:
    def __init__(self, process, url=None, token=None):
        self.process, self.url, self.token = process, url, token
        self.sequence, self.session = 0, None
    def request(self, method, params=None, notification=False):
        self.sequence += 1
        data = {'jsonrpc': '2.0', 'method': method}
        if params is not None: data['params'] = params
        if not notification: data['id'] = self.sequence
        raw = json.dumps(data).encode()
        if not self.url:
            self.process.stdin.write(raw + b'\n'); self.process.stdin.flush()
            if notification: return
            answer = json.loads(self.process.stdout.readline())
        else:
            headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + self.token, 'MCP-Protocol-Version': '2025-11-25'}
            if self.session: headers['Mcp-Session-Id'] = self.session
            request = urllib.request.Request(self.url, data=raw, headers=headers)
            with urllib.request.urlopen(request, timeout=30) as response:
                self.session = response.headers.get('Mcp-Session-Id', self.session)
                if notification: return
                payload = response.read().decode()
                if response.headers.get('Content-Type', '').startswith('text/event-stream'):
                    answers = [json.loads(line[6:]) for line in payload.splitlines() if line.startswith('data: ') and line[6:].strip()]
                    answer = next(a for a in answers if a.get('id') == self.sequence)
                else: answer = json.loads(payload)
        assert answer.get('id') == self.sequence, answer
        assert 'error' not in answer, answer
        return answer['result']
    def tool(self, name, arguments, write=False):
        arguments = {'schema_version': 1, **arguments}
        if write:
            arguments.update(request_id=str(uuid.uuid4()), idempotency_key=str(uuid.uuid4()))
        result = self.request('tools/call', {'name': name, 'arguments': arguments})
        assert not result.get('isError'), result
        return json.loads(result['content'][0]['text'])

def scenario(mode):
    with tempfile.TemporaryDirectory(prefix='agai-real-mcp-') as folder:
        base = Path(folder); repo = base / 'repo'; repo.mkdir(); profile = base / 'profile'; profile.mkdir(mode=0o700)
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        (repo / 'a.cs').write_text('human baseline\n')
        host = subprocess.Popen([str(HOST), str(profile)], stderr=subprocess.PIPE)
        gateway = None
        try:
            wait_until(lambda: (profile / 'host.sock').exists())
            argv = [str(GATEWAY), '--profile', str(profile), '--repo', str(repo)]
            url = token = None
            if mode == 'http':
                with socket.socket() as reserved:
                    reserved.bind(('127.0.0.1', 0)); port = reserved.getsockname()[1]
                token = os.urandom(32).hex(); token_file = profile / 'http-token'
                fd = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w') as output: output.write(token)
                argv += ['--http', str(port), '--http-token-file', str(token_file)]
                url = f'http://127.0.0.1:{port}/mcp'
            gateway = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if url:
                def ready():
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=.1): return True
                    except OSError: return False
                wait_until(ready)
            client = Client(gateway, url, token)
            initialized = client.request('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'agai-raw-python-acceptance', 'version': '1'}})
            assert initialized['protocolVersion'] == '2025-11-25'
            client.request('notifications/initialized', notification=True)
            tools = client.request('tools/list')['tools']; assert len(tools) == 9
            guide = client.tool('integration_guide', {})
            scope = {key: guide[key] for key in ('repo_id', 'worktree_id')}
            context_args = {**scope, 'task': 'explain real edit', 'paths': ['a.cs'], 'budget_chars': 2000}
            before = client.tool('context_get', context_args)
            session = client.tool('session_open', {**scope, 'task': 'explain real edit', 'actor': 'raw Python harness', 'expected_generation': before['generation']}, True)
            (repo / 'a.cs').write_text('agent changed\n')
            after = client.tool('context_get', context_args)
            captured = client.tool('snapshot_capture', {'session_id': session['session_id'], 'paths': ['a.cs'], 'expected_generation': after['generation']}, True)
            decision = {'session_id': session['session_id'], 'snapshot_id': captured['snapshot_id'], 'summary': 'Explain changed line', 'behavior': 'Changed fixture line', 'rationale': 'Requested scenario', 'constraints': ['Preserve baseline'], 'alternatives': [{'description': 'Keep old line', 'reason_not_chosen': 'Scenario requires edit'}], 'source': 'agent_reported', 'anchors': [{'comparison_id': captured['comparison']['id'], 'snapshot_id': captured['snapshot_id'], 'path': 'a.cs', 'side': 'new', 'start_line': 1, 'end_line': 1, 'content_hash': hashlib.sha256(b'agent changed\n').hexdigest()}]}
            recorded = client.tool('decision_record', {'decision': decision}, True)
            evidence = client.tool('evidence_record', {'session_id': session['session_id'], 'snapshot_id': captured['snapshot_id'], 'decision_ids': [recorded['decision_id']], 'check': 'fixture bytes', 'status': 'passed', 'environment': 'Python integration harness', 'summary': 'Agent reported check only', 'source': 'agent_reported'}, True)
            assert evidence['source'] == 'agent_reported'
            client.tool('event_append', {'session_id': session['session_id'], 'snapshot_id': captured['snapshot_id'], 'kind': 'observation', 'text': 'First edit recorded', 'parent_event_ids': [], 'source': 'agent_reported'}, True)
            (repo / 'a.cs').write_text('agent revised code\n')
            current = client.tool('context_get', context_args)
            captured = client.tool('snapshot_capture', {'session_id': session['session_id'], 'paths': ['a.cs'], 'expected_generation': current['generation']}, True)
            decision = {**decision, 'snapshot_id': captured['snapshot_id'], 'anchors': [{**decision['anchors'][0], 'comparison_id': captured['comparison']['id'], 'snapshot_id': captured['snapshot_id'], 'content_hash': hashlib.sha256(b'agent revised code\n').hexdigest()}]}
            revised = client.tool('decision_supersede', {'old_decision_id': recorded['decision_id'], 'expected_revision': 1, 'reason': 'Clarify rationale', 'new_decision': {**decision, 'rationale': 'Exact source anchored rationale'}}, True)
            final = client.tool('session_close', {'session_id': session['session_id'], 'final_snapshot_id': captured['snapshot_id'], 'outcome': 'completed', 'summary': 'Scenario complete', 'unresolved': []}, True)
            assert final['outcome'] == 'completed'
            query = {'kind': 'GetDecisions', 'scope': scope, 'comparison_id': captured['comparison']['id'], 'path': {'display': 'a.cs', 'raw_base64': base64.b64encode(b'a.cs').decode(), 'encoding': 'unix_bytes'}}
            history = desktop(profile, query)['decisions']; assert len(history) == 2
            old = next(d for d in history if d['id'] == recorded['decision_id']); assert old['superseded_by'] == revised['decision_id']
            assert old['evidence'][0]['status'] == 'passed'
            review = desktop(profile, {'kind': 'ReviewDecision', 'scope': scope, 'decision_id': revised['decision_id'], 'base_snapshot_id': captured['comparison']['base_snapshot_id'], 'target_snapshot_id': captured['snapshot_id'], 'state': 'Accepted', 'note': 'Automated local-user route verification', 'idempotency_key': str(uuid.uuid4())})
            assert review['review']['state'] == 'Accepted'
            reread = desktop(profile, query)['decisions']; assert next(d for d in reread if d['id'] == revised['decision_id'])['review']['state'] == 'Accepted'
            assert (repo / 'a.cs').read_bytes() == b'agent revised code\n'
            print(json.dumps({'harness': 'raw-python-jsonrpc', 'transport': mode, 'tools': len(tools), 'decision_versions': len(history), 'human_review_route': 'verified', 'result': 'passed'}))
        finally:
            if gateway: gateway.kill(); gateway.wait(timeout=5)
            host.kill(); host.wait(timeout=5)

if __name__ == '__main__':
    scenario('stdio')
    scenario('http')
