// Test-only HTTP adapter: production builds never include this entry or server.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
export function testHost() {
  const dir = mkdtempSync(join(tmpdir(), "agai-ui-"));
  const repo = join(dir, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", repo]);
  git("config", "user.name", "UI Test");
  git("config", "user.email", "ui@example.invalid");
  writeFileSync(
    join(repo, "Code.cs"),
    "public sealed class Wallet {\n    public int Balance = 30;\n    public bool Spend(int cost) {\n        if (Balance < cost) return false;\n        Balance -= cost;\n        return true;\n    }\n}\n",
  );
  writeFileSync(join(repo, "Deleted.cs"), "class Removed {}\n");
  writeFileSync(
    join(repo, "Large.cs"),
    Array.from({ length: 1900 }, (_, i) => `// line ${i}`).join("\n"),
  );
  writeFileSync(join(repo, "EarlierDeleted.cs"), "class EarlierDeleted {}\n");
  git("add", ".");
  git("commit", "-qm", "Initial wallet");
  const first = git("rev-parse", "HEAD");
  git("branch", "feature");
  git("rm", "EarlierDeleted.cs");
  git("commit", "-qm", "Remove old class");
  writeFileSync(join(repo, "Readme.md"), "# Project\n");
  git("add", ".");
  git("commit", "-qm", "Document wallet");
  const second = git("rev-parse", "HEAD");
  writeFileSync(
    join(repo, "Code.cs"),
    readFileSync(join(repo, "Code.cs"), "utf8").replace("30", "50"),
  );
  rmSync(join(repo, "Deleted.cs"));
  const host = spawn(
    resolve("../../target/debug/agai-host"),
    [join(dir, "profile")],
    { stdio: "ignore" },
  );
  const cleanup = () => {
    host.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  process.once("exit", cleanup);
  return {
    name: "test-host",
    configureServer(server: any) {
      server.httpServer?.once("close", cleanup);
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === "/test-info") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              repo,
              first,
              second,
              bench: process.env.AGAI_UI_BENCH_REPO,
            }),
          );
          return;
        }
        if (req.url === "/test-change") {
          writeFileSync(join(repo, "Code.cs"), "class ChangedExternally {}\n");
          res.end("ok");
          return;
        }
        if (req.url !== "/test-rpc") {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const payload = Buffer.concat(chunks);
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32BE(payload.length);
        const socket = createConnection(join(dir, "profile", "host.sock"));
        socket.setTimeout(30000);
        let bytes = Buffer.alloc(0);
        socket.on("connect", () =>
          socket.write(Buffer.concat([prefix, payload])),
        );
        socket.on("data", (chunk) => {
          bytes = Buffer.concat([bytes, chunk]);
          if (bytes.length >= 4 && bytes.length >= 4 + bytes.readUInt32BE(0)) {
            res.setHeader("Content-Type", "application/json");
            res.end(bytes.subarray(4, 4 + bytes.readUInt32BE(0)));
            socket.end();
          }
        });
        socket.on("error", () => {
          res.statusCode = 503;
          res.end("HOST_OFFLINE");
        });
        socket.on("timeout", () => socket.destroy());
      });
    },
  };
}
