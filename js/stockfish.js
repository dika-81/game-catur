export const ENGINE_VERSION = "18.0.7-20260712-1";

const ENGINE_JS = new URL("../assets/engine/stockfish-18-lite-single.js", import.meta.url);
const ENGINE_WASM = new URL("../assets/engine/stockfish-18-lite-single.wasm", import.meta.url);
const UCI_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 30000;

export function scoreFromLine(line) {
  const match = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!match) return null;
  return { type: match[1], value: Number(match[2]) };
}

export function engineAssetUrls(retry = false) {
  const worker = new URL(ENGINE_JS);
  const wasm = new URL(ENGINE_WASM);
  worker.searchParams.set("v", ENGINE_VERSION);
  wasm.searchParams.set("v", ENGINE_VERSION);
  if (retry) {
    worker.searchParams.set("retry", "1");
    wasm.searchParams.set("retry", "1");
  }
  return {
    worker,
    wasm,
    // Stockfish 18 reads the encoded WASM URL from hash[0] and requires
    // hash[1] === "worker". Query parameters must stay before this fragment.
    entry: `${worker.href}#${encodeURIComponent(wasm.href)},worker`,
  };
}

export class EngineLoadError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "EngineLoadError";
    this.code = code;
    this.stage = options.stage || "unknown";
    this.url = options.url || "";
    this.status = options.status;
  }
}

export function describeEngineError(error) {
  if (!(error instanceof EngineLoadError)) return error?.message || "Kesalahan Stockfish tidak diketahui.";
  const location = error.url ? ` (${error.url})` : "";
  switch (error.code) {
    case "http": return `${error.stage === "wasm" ? "File WASM" : "Worker Stockfish"} gagal dimuat: HTTP ${error.status}${location}.`;
    case "wasm-mime": return `MIME file WASM bukan application/wasm${location}.`;
    case "worker-mime": return `MIME JavaScript worker tidak valid${location}.`;
    case "worker-create": return `Web Worker gagal dibuat. Periksa dukungan browser atau kebijakan CSP${location}.`;
    case "worker-runtime": return `Web Worker berhenti saat memuat Stockfish: ${error.message}${location}.`;
    case "uci-timeout": return `Stockfish tidak mengirim uciok dalam ${UCI_TIMEOUT_MS / 1000} detik${location}.`;
    case "ready-timeout": return `Stockfish tidak mengirim readyok dalam ${READY_TIMEOUT_MS / 1000} detik${location}.`;
    case "network": return `Aset ${error.stage === "wasm" ? "WASM" : "worker"} tidak dapat diakses. Periksa jaringan, CSP, CORS, atau cache${location}.`;
    default: return error.message;
  }
}

export class StockfishEngine {
  constructor(onDiagnostic = () => {}) {
    this.worker = null;
    this.ready = false;
    this.activeSearch = null;
    this.searchQueue = [];
    this.waiters = new Map();
    this.onDiagnostic = onDiagnostic;
    this.currentUrls = null;
    this.boundWorkerError = null;
  }

  diagnostic(stage, message, detail = {}) {
    const payload = { stage, message, ...detail };
    console.info(`[Stockfish] ${stage}: ${message}`, payload);
    this.onDiagnostic(payload);
  }

  async init() {
    if (this.ready) return;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.initAttempt(attempt);
        return;
      } catch (error) {
        lastError = error;
        console.error(`[Stockfish] Percobaan ${attempt + 1} gagal:`, error);
        this.cleanupWorker();
        if (attempt === 0) {
          this.diagnostic("retry", "Pemuatan pertama gagal; mencoba sekali lagi tanpa cache.", { error });
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    throw lastError;
  }

  async initAttempt(attempt) {
    this.currentUrls = engineAssetUrls(attempt > 0);
    this.diagnostic("preflight", `Memeriksa aset engine (percobaan ${attempt + 1}/2).`, {
      workerUrl: this.currentUrls.worker.href,
      wasmUrl: this.currentUrls.wasm.href,
    });
    await this.checkAsset(this.currentUrls.worker, "worker");
    await this.checkAsset(this.currentUrls.wasm, "wasm");

    this.diagnostic("worker", "Membuat Web Worker Stockfish 18.", { url: this.currentUrls.entry });
    try {
      this.worker = new Worker(this.currentUrls.entry, { name: "stockfish-18" });
    } catch (cause) {
      throw new EngineLoadError("worker-create", cause.message, {
        cause, stage: "worker", url: this.currentUrls.entry,
      });
    }

    this.worker.addEventListener("message", (event) => this.onMessage(String(event.data)));
    this.boundWorkerError = (event) => {
      event.preventDefault?.();
      this.fail(new EngineLoadError("worker-runtime", event.message || "Worker error tanpa rincian", {
        stage: "worker", url: this.currentUrls.entry,
      }));
    };
    this.worker.addEventListener("error", this.boundWorkerError);
    this.worker.addEventListener("messageerror", () => this.fail(new EngineLoadError(
      "worker-runtime", "Pesan dari worker tidak dapat dibaca", { stage: "worker", url: this.currentUrls.entry },
    )));

    this.diagnostic("uci", "Menunggu uciok dari Stockfish.");
    const uciOk = this.waitFor("uciok", UCI_TIMEOUT_MS, "uci-timeout");
    this.send("uci");
    await uciOk;

    this.send("setoption name Hash value 16");
    this.diagnostic("ready", "Menunggu readyok dari Stockfish.");
    const readyOk = this.waitFor("readyok", READY_TIMEOUT_MS, "ready-timeout");
    this.send("isready");
    await readyOk;
    this.ready = true;
    this.diagnostic("complete", "Stockfish 18 WebAssembly siap.");
  }

  async checkAsset(url, stage) {
    let response;
    try {
      response = await fetch(url, { method: "HEAD", cache: "no-cache", credentials: "same-origin" });
    } catch (cause) {
      throw new EngineLoadError("network", cause.message, { cause, stage, url: url.href });
    }
    if (!response.ok) {
      throw new EngineLoadError("http", `HTTP ${response.status}`, {
        stage, status: response.status, url: response.url || url.href,
      });
    }
    const mime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    this.diagnostic(stage, `HTTP ${response.status}; MIME ${mime || "tidak dikirim"}.`, {
      url: response.url || url.href, status: response.status, mime,
    });
    if (stage === "wasm" && mime !== "application/wasm") {
      throw new EngineLoadError("wasm-mime", `MIME ${mime || "kosong"}`, { stage, url: response.url || url.href });
    }
    if (stage === "worker" && mime && !/(javascript|ecmascript)/.test(mime)) {
      throw new EngineLoadError("worker-mime", `MIME ${mime}`, { stage, url: response.url || url.href });
    }
  }

  onMessage(line) {
    if (line === "uciok" || line === "readyok") {
      this.diagnostic(line, `Worker mengirim ${line}.`);
      const callbacks = this.waiters.get(line) || [];
      callbacks.splice(0).forEach((callback) => callback.resolve());
      this.waiters.delete(line);
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

  waitFor(token, timeoutMs, timeoutCode) {
    return new Promise((resolve, reject) => {
      const callback = {
        resolve: () => { clearTimeout(callback.timeout); resolve(); },
        reject: (error) => { clearTimeout(callback.timeout); reject(error); },
        timeout: null,
      };
      callback.timeout = setTimeout(() => {
        const callbacks = this.waiters.get(token) || [];
        const index = callbacks.indexOf(callback);
        if (index >= 0) callbacks.splice(index, 1);
        if (!callbacks.length) this.waiters.delete(token);
        reject(new EngineLoadError(timeoutCode, `Waktu tunggu ${token} habis`, {
          stage: token, url: this.currentUrls?.entry,
        }));
      }, timeoutMs);
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

  fail(error) {
    if (error instanceof EngineLoadError) this.ready = false;
    if (this.activeSearch) {
      this.activeSearch.reject(error);
      this.activeSearch = null;
    }
    this.searchQueue.splice(0).forEach((search) => search.reject(error));
    for (const callbacks of this.waiters.values()) callbacks.splice(0).forEach((item) => item.reject(error));
    this.waiters.clear();
  }

  cleanupWorker() {
    this.fail(new Error("Percobaan pemuatan Stockfish dihentikan."));
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  destroy() {
    this.send("quit");
    this.cleanupWorker();
  }
}
