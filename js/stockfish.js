const ENGINE_JS = new URL("../assets/engine/stockfish-18-lite-single.js", import.meta.url);
const ENGINE_WASM = new URL("../assets/engine/stockfish-18-lite-single.wasm", import.meta.url);

export function scoreFromLine(line) {
  const match = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!match) return null;
  return { type: match[1], value: Number(match[2]) };
}

export class StockfishEngine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.activeSearch = null;
    this.searchQueue = [];
    this.waiters = new Map();
  }

  async init() {
    if (this.ready) return;
    const workerUrl = `${ENGINE_JS.href}#${encodeURIComponent(ENGINE_WASM.href)},worker`;
    this.worker = new Worker(workerUrl);
    this.worker.addEventListener("message", (event) => this.onMessage(String(event.data)));
    this.worker.addEventListener("error", (event) => this.fail(event.message || "Stockfish gagal dimuat."));
    this.send("uci");
    await this.waitFor("uciok", 30000);
    this.send("setoption name Hash value 16");
    this.send("isready");
    await this.waitFor("readyok", 30000);
    this.ready = true;
  }

  onMessage(line) {
    if (line === "uciok" || line === "readyok") {
      const callbacks = this.waiters.get(line) || [];
      callbacks.splice(0).forEach((callback) => callback.resolve());
      return;
    }

    if (!this.activeSearch) return;
    if (line.startsWith("info ")) {
      const score = scoreFromLine(line);
      if (score) this.activeSearch.score = score;
      return;
    }

    if (line.startsWith("bestmove ")) {
      const bestMove = line.split(/\s+/)[1];
      const search = this.activeSearch;
      this.activeSearch = null;
      search.resolve({ bestMove: bestMove === "(none)" ? null : bestMove, score: search.score });
      queueMicrotask(() => this.runNextSearch());
    }
  }

  waitFor(token, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Waktu tunggu ${token} habis.`)), timeoutMs);
      const callback = {
        resolve: () => { clearTimeout(timeout); resolve(); },
        reject,
      };
      if (!this.waiters.has(token)) this.waiters.set(token, []);
      this.waiters.get(token).push(callback);
    });
  }

  search(fen, depth) {
    if (!this.ready) return Promise.reject(new Error("Stockfish belum siap."));
    return new Promise((resolve, reject) => {
      this.searchQueue.push({ fen, depth: Math.max(1, Number(depth) || 1), resolve, reject, score: null });
      this.runNextSearch();
    });
  }

  runNextSearch() {
    if (this.activeSearch || !this.searchQueue.length) return;
    this.activeSearch = this.searchQueue.shift();
    this.send(`position fen ${this.activeSearch.fen}`);
    this.send(`go depth ${this.activeSearch.depth}`);
  }

  send(command) { this.worker?.postMessage(command); }

  fail(message) {
    const error = new Error(message);
    if (this.activeSearch) {
      this.activeSearch.reject(error);
      this.activeSearch = null;
    }
    this.searchQueue.splice(0).forEach((search) => search.reject(error));
    for (const callbacks of this.waiters.values()) callbacks.splice(0).forEach((item) => item.reject(error));
  }

  destroy() {
    this.send("quit");
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }
}
