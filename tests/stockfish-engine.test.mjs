import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { StockfishEngine, engineAssetUrls } from "../js/stockfish.js";

test("URL worker mempertahankan subpath dan tidak memakai mode worker internal", () => {
  const { worker, wasm, entry } = engineAssetUrls();
  const parsed = new URL(entry);
  const [encodedWasm, internalMode] = parsed.hash.slice(1).split(",");

  assert.equal(internalMode, undefined);
  assert.equal(decodeURIComponent(encodedWasm), wasm.href);
  assert.equal(worker.pathname.replace(/\.js$/, ".wasm"), wasm.pathname);
  assert.ok(worker.searchParams.has("v"));
  assert.equal(worker.searchParams.get("v"), wasm.searchParams.get("v"));
  assert.ok(entry.indexOf("?v=") < entry.indexOf("#"));
  assert.doesNotMatch(entry, /,worker$/);
});

test("StockfishEngine mengembalikan depth dan PV terbaru bersama bestmove", async () => {
  const engine = new StockfishEngine();
  const result = new Promise((resolve, reject) => {
    engine.activeSearch = {
      resolve,
      reject,
      score: null,
      reachedDepth: 0,
      pvDepth: null,
      pv: [],
    };
  });

  engine.onMessage("info depth 11 score cp 18 pv d2d4 d7d5 c2c4");
  engine.onMessage("info depth 12 score cp 24 pv e2e4 e7e5 g1f3 b8c6");
  engine.onMessage("bestmove e2e4");

  assert.deepEqual(await result, {
    bestMove: "e2e4",
    score: { type: "cp", value: 24 },
    depth: 12,
    pv: ["e2e4", "e7e5", "g1f3", "b8c6"],
  });
});

test("Stockfish berjalan di Worker dan membalas protokol UCI", { timeout: 45000 }, async () => {
  const engineJs = await readFile(new URL("../assets/engine/stockfish-18-lite-single.js", import.meta.url), "utf8");
  const engineWasm = await readFile(new URL("../assets/engine/stockfish-18-lite-single.wasm", import.meta.url));
  const server = createServer((request, response) => {
    if (new URL(request.url, "http://localhost").pathname.endsWith(".wasm")) {
      response.writeHead(200, { "Content-Type": "application/wasm" });
      response.end(engineWasm);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const wasmUrl = `http://127.0.0.1:${port}/stockfish.wasm?v=test`;
  const entry = `http://127.0.0.1:${port}/stockfish.js?v=test#${encodeURIComponent(wasmUrl)}`;
  const bootstrap = `
    const { parentPort, workerData } = require("node:worker_threads");
    const vm = require("node:vm");
    let handler = null;
    const pending = [];
    global.self = global;
    global.location = new URL(workerData.entry);
    global.importScripts = function () {};
    global.postMessage = (data) => parentPort.postMessage(data);
    Object.defineProperty(global, "onmessage", {
      configurable: true,
      get: () => handler,
      set: (value) => {
        handler = value;
        while (pending.length) handler({ data: pending.shift() });
      }
    });
    parentPort.on("message", (data) => handler ? handler({ data }) : pending.push(data));
    global.process = undefined;
    vm.runInThisContext(workerData.source, { filename: "stockfish-18-lite-single.js" });
  `;
  const worker = new Worker(bootstrap, { eval: true, workerData: { entry, source: engineJs } });

  try {
    const bestMove = await new Promise((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", (value) => {
        const line = String(value);
        if (line === "uciok") worker.postMessage("isready");
        else if (line === "readyok") {
          worker.postMessage("position startpos moves e2e4");
          worker.postMessage("go depth 2");
        } else if (line.startsWith("bestmove ")) resolve(line.split(/\s+/)[1]);
      });
      worker.postMessage("uci");
    });
    assert.match(bestMove, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
  } finally {
    await worker.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});
