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

async function check(endpoint) {
  const response = await fetch(endpoint);
  return { ok: response.ok, status: response.status, body: await response.text() };
}

async function run() {
  let failed = false;
  for (const [name, port] of services) {
    const health = await check(`http://localhost:${port}/health`);
    const ready = await check(`http://localhost:${port}/ready`);
    const ok = health.ok && ready.ok;
    failed = failed || !ok;
    console.log(
      JSON.stringify({
        service: name,
        healthStatus: health.status,
        readinessStatus: ready.status,
        ok
      })
    );
  }
  if (failed) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
