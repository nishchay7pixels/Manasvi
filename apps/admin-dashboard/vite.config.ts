import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4200,
    proxy: {
      "/api/gateway":      { target: "http://localhost:4100", rewrite: (p) => p.replace("/api/gateway", "") },
      "/api/ingress":      { target: "http://localhost:4101", rewrite: (p) => p.replace("/api/ingress", "") },
      "/api/orchestrator": { target: "http://localhost:4102", rewrite: (p) => p.replace("/api/orchestrator", "") },
      "/api/policy":       { target: "http://localhost:4103", rewrite: (p) => p.replace("/api/policy", "") },
      "/api/execution":    { target: "http://localhost:4104", rewrite: (p) => p.replace("/api/execution", "") },
      "/api/memory":       { target: "http://localhost:4105", rewrite: (p) => p.replace("/api/memory", "") },
      "/api/nodes":        { target: "http://localhost:4106", rewrite: (p) => p.replace("/api/nodes", "") },
      "/api/audit":        { target: "http://localhost:4107", rewrite: (p) => p.replace("/api/audit", "") },
      "/api/approvals":    { target: "http://localhost:4108", rewrite: (p) => p.replace("/api/approvals", "") },
    }
  }
});
