import test from "node:test";
import assert from "node:assert/strict";
import { engineAssetUrls } from "../js/stockfish.js";

test("URL worker mempertahankan subpath, versioning, dan fragment Stockfish 18", () => {
  const { worker, wasm, entry } = engineAssetUrls();
  const parsed = new URL(entry);
  const [encodedWasm, mode] = parsed.hash.slice(1).split(",");

  assert.equal(mode, "worker");
  assert.equal(decodeURIComponent(encodedWasm), wasm.href);
  assert.equal(worker.pathname.replace(/\.js$/, ".wasm"), wasm.pathname);
  assert.ok(worker.searchParams.has("v"));
  assert.equal(worker.searchParams.get("v"), wasm.searchParams.get("v"));
  assert.ok(entry.indexOf("?v=") < entry.indexOf("#"));
});
