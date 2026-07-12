import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

test("entry point hanya memakai path relatif GitHub Pages", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /\.\/js\/app\.js/);
  assert.doesNotMatch(html, /url_for|fetch\(["']\//);
});

test("aset Stockfish WebAssembly tersedia dan valid", async () => {
  const wasmUrl = new URL("../assets/engine/stockfish-18-lite-single.wasm", import.meta.url);
  const header = new Uint8Array((await readFile(wasmUrl)).subarray(0, 8));
  assert.deepEqual([...header.subarray(0, 4)], [0, 97, 115, 109]);
  assert.ok((await stat(wasmUrl)).size > 7_000_000);
  const worker = await readFile(new URL("../assets/engine/stockfish-18-lite-single.js", import.meta.url), "utf8");
  assert.match(worker, /Stockfish\.js 18/);
});

test("tidak ada ketergantungan jaringan pada aplikasi", async () => {
  const files = ["../index.html", "../styles.css", "../js/app.js", "../js/game.js", "../js/stockfish.js"];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /https?:\/\//);
  }
});
