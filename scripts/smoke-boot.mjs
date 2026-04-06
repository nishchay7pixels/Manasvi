import { spawn } from "node:child_process";

const services = [
  ["api-gateway", 4100],
  ["ingress-service", 4101],
  ["orchestrator-service", 4102],
  ["policy-service", 4103],
  ["execution-manager", 4104],
  ["memory-service", 4105],
  ["node-manager", 4106],
  ["audit-service", 4107]
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return res;
      }
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function bootAndCheck(name, port) {
  const child = spawn("node", [`apps/${name}/dist/index.js`], {
    stdio: "pipe",
    env: {
      ...process.env,
      MANASVI_ENV: "local",
      SERVICE_HOST: "127.0.0.1",
      SERVICE_PORT: String(port),
      LOG_LEVEL: "info",
      HUMAN_LOGS: "false",
      INTERNAL_AUTH_ISSUER: "manasvi.internal.auth",
      INTERNAL_AUTH_AUDIENCE: "manasvi.internal.services",
      INTERNAL_AUTH_KEY_ID: "local-k1",
      INTERNAL_AUTH_SIGNING_SECRET: "local-dev-internal-secret",
      INTERNAL_AUTH_VERIFICATION_KEYS: "local-k1:local-dev-internal-secret"
    }
  });

  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  try {
    const health = await waitFor(`http://127.0.0.1:${port}/health`);
    const ready = await waitFor(`http://127.0.0.1:${port}/ready`);
    console.log(
      JSON.stringify({
        service: name,
        health: health.status,
        ready: ready.status,
        ok: true
      })
    );
  } finally {
    child.kill("SIGTERM");
    await delay(200);
  }
}

async function main() {
  for (const [name, port] of services) {
    await bootAndCheck(name, port);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      message: "Smoke boot failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});
