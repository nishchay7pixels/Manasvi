import { createServer } from "node:http";

/** Pick a free TCP port on localhost. */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Could not determine free port"));
        }
      });
    });
    server.once("error", reject);
  });
}
