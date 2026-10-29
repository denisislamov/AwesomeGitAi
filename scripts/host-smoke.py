"""Run the real host process against a disposable profile, never a user database."""
import json, os, pathlib, socket, struct, subprocess, tempfile, time, uuid

with tempfile.TemporaryDirectory(prefix="agai-host-smoke-") as directory:
    profile = pathlib.Path(directory) / "profile"
    host = subprocess.Popen(["target/debug/agai-host", str(profile)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        address = profile / "host.sock"
        for _ in range(100):
            if address.exists():
                break
            if host.poll() is not None:
                raise RuntimeError(host.stderr.read().decode())
            time.sleep(0.02)
        assert profile.stat().st_mode & 0o777 == 0o700
        assert address.stat().st_mode & 0o777 == 0o600
        duplicate = subprocess.run(["target/debug/agai-host", str(profile)], capture_output=True, timeout=5)
        assert duplicate.returncode != 0 and b"HOST_ALREADY_RUNNING" in duplicate.stderr
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(5)
            client.connect(str(address))
            payload = json.dumps({"meta":{"schema_version":1,"request_id":str(uuid.uuid4()),"idempotency_key":None},"request":{"kind":"Hello"}}).encode()
            client.sendall(struct.pack(">I", len(payload)) + payload)
            def receive(n):
                data = b""
                while len(data) < n:
                    chunk = client.recv(n - len(data))
                    if not chunk:
                        raise RuntimeError("Truncated reply")
                    data += chunk
                return data
            size, = struct.unpack(">I", receive(4))
            assert size <= 16 * 1024 * 1024
            reply = json.loads(receive(size))
            assert reply["Ok"]["kind"] == "Hello" and reply["Ok"]["schema_version"] == 1
        print("real host: private profile/socket, singleton and framed hello passed")
    finally:
        host.terminate()
        try:
            host.wait(timeout=5)
        except subprocess.TimeoutExpired:
            host.kill()
            host.wait()
