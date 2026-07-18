import {
  GameModel,
  GAME_MODES,
  PIECES,
  START_SECONDS,
  canUserMove,
  formatTime,
  modeUsesClock,
  normalizeGameMode,
  shouldBotMove,
  uciToMove,
} from "./game.js?v=20260718-1";
import { StockfishEngine, describeEngineError } from "./stockfish.js?v=20260718-1";

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#board");
const statusElement = $("#status");
const statusDetail = $("#status-detail");
const engineState = $("#engine-state");
const nameDialog = $("#name-dialog");
const resultDialog = $("#result-dialog");
const promotionDialog = $("#promotion-dialog");
const analysisCard = $("#analysis-card");
const storageKey = "chess-ai-pgsd-state-v1";
const ANALYSIS_DEPTH = 12;
const PV_MAX_PLY = 8;

const saved = readSavedState();
const game = new GameModel(saved.pgn);
const engine = new StockfishEngine(({ stage, message, error }) => {
  if (stage === "retry") {
    engineState.textContent = "Mencoba ulang Stockfish…";
    setStatus("Mencoba ulang engine…", describeEngineError(error));
  } else if (stage !== "complete" && stage !== "uciok" && stage !== "readyok") {
    engineState.textContent = "Memuat Stockfish 18…";
    setStatus("Memuat engine…", message);
  }
});

let playerName = saved.playerName || "";
let mode = normalizeGameMode(saved.mode);
let whiteTime = Number.isFinite(saved.whiteTime) ? saved.whiteTime : START_SECONDS;
let blackTime = Number.isFinite(saved.blackTime) ? saved.blackTime : START_SECONDS;
let selected = null;
let legalMoves = [];
let bestMoveSquares = null;
let thinking = false;
let analysisBusy = false;
let evaluationBusy = false;
let gameEnded = Boolean(game.outcome());
let engineReady = false;
let lastTick = performance.now();
let gameVersion = 0;
let gameStarted = Boolean(playerName);
let lastAnalyzedFen = "";

function readSavedState() {
  try { return JSON.parse(sessionStorage.getItem(storageKey)) || {}; }
  catch { return {}; }
}

function saveState() {
  sessionStorage.setItem(storageKey, JSON.stringify({
    playerName,
    mode,
    pgn: game.pgn(),
    whiteTime,
    blackTime,
    difficulty: $("#difficulty")?.value || "6",
  }));
}

function squareName(row, column) {
  return "abcdefgh"[column] + (8 - row);
}

function renderBoard() {
  const position = game.board();
  const history = game.history();
  const lastMove = history.at(-1);
  const checkedKing = game.isCheck() ? findKingSquare(position, game.turn()) : null;
  boardElement.replaceChildren();

  position.forEach((rank, row) => rank.forEach((piece, column) => {
    const square = squareName(row, column);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `square${(row + column) % 2 ? " dark" : ""}`;
    button.dataset.square = square;
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", describeSquare(square, piece));
    if (selected === square) button.classList.add("selected");
    if (lastMove && (lastMove.from === square || lastMove.to === square)) button.classList.add("last-move");
    if (bestMoveSquares?.from === square) button.classList.add("best-origin");
    if (bestMoveSquares?.to === square) button.classList.add("best-target");
    if (checkedKing === square) button.classList.add("in-check");
    const targetMove = legalMoves.find((move) => move.to === square);
    if (targetMove) button.classList.add(piece ? "capture-target" : "legal-target");

    if (piece) {
      const glyph = document.createElement("span");
      glyph.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
      glyph.textContent = PIECES[piece.color + piece.type];
      button.append(glyph);
    }
    if (column === 0) button.append(coordinate("rank", String(8 - row)));
    if (row === 7) button.append(coordinate("file", "abcdefgh"[column]));
    button.addEventListener("click", () => handleSquare(square));
    boardElement.append(button);
  }));
  boardElement.setAttribute("aria-busy", String(thinking || analysisBusy));
  renderHistory(history);
  updateAnalysisControls();
}

function coordinate(className, text) {
  const span = document.createElement("span");
  span.className = `coordinate ${className}`;
  span.textContent = text;
  return span;
}

function describeSquare(square, piece) {
  if (!piece) return `${square}, kosong`;
  const names = { p: "pion", n: "kuda", b: "gajah", r: "benteng", q: "menteri", k: "raja" };
  return `${square}, ${names[piece.type]} ${piece.color === "w" ? "putih" : "hitam"}`;
}

function findKingSquare(position, color) {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = position[row][col];
      if (piece?.type === "k" && piece.color === color) return squareName(row, col);
    }
  }
  return null;
}

function renderHistory(history) {
  const list = $("#move-list");
  if (!history.length) {
    list.innerHTML = '<li class="empty-history">Belum ada langkah.</li>';
    return;
  }
  list.replaceChildren();
  for (let index = 0; index < history.length; index += 2) {
    const item = document.createElement("li");
    const whiteMove = document.createElement("span");
    whiteMove.textContent = history[index].san;
    item.append(whiteMove, document.createTextNode(history[index + 1]?.san || ""));
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}

async function handleSquare(square) {
  if (
    !gameStarted
    || !engineReady
    || thinking
    || analysisBusy
    || gameEnded
    || !canUserMove(mode, game.turn())
  ) return;

  const piece = game.piece(square);
  const movableColor = game.turn();
  if (!selected) {
    if (piece?.color === movableColor) selectSquare(square);
    return;
  }
  if (piece?.color === movableColor) {
    selectSquare(square);
    return;
  }
  const candidate = legalMoves.find((move) => move.to === square);
  if (!candidate) {
    clearSelection();
    renderBoard();
    return;
  }
  const promotion = candidate.flags.includes("p") ? await choosePromotion() : "q";
  if (!promotion) return;
  const move = game.move(selected, square, promotion);
  clearSelection();
  if (!move) return renderBoard();

  gameVersion += 1;
  clearBestMove();
  playTone(move.color === "w" ? 760 : 480);
  saveState();
  renderBoard();
  if (finishIfNeeded()) return;
  if (shouldBotMove(mode, game.turn())) await makeAiMove();
  else await analyzePosition();
}

function selectSquare(square) {
  selected = square;
  legalMoves = game.legalMoves(square);
  renderBoard();
}

function clearSelection() {
  selected = null;
  legalMoves = [];
}

function clearBestMove() {
  bestMoveSquares = null;
  lastAnalyzedFen = "";
  $("#best-move").textContent = "—";
  $("#principal-variation").textContent = "—";
  $("#analysis-depth").textContent = "Menunggu";
}

function choosePromotion() {
  promotionDialog.returnValue = "";
  promotionDialog.showModal();
  return new Promise((resolve) => {
    promotionDialog.addEventListener("close", () => resolve(promotionDialog.returnValue || null), { once: true });
  });
}

async function makeAiMove() {
  if (!engineReady || thinking || analysisBusy || gameEnded || !shouldBotMove(mode, game.turn())) return;
  const version = gameVersion;
  const startingMode = mode;
  let searchApplied = false;
  thinking = true;
  document.body.classList.add("thinking");
  boardElement.setAttribute("aria-busy", "true");
  setStatus("AI sedang berpikir…", "Stockfish menghitung langkah terbaik.");
  const start = performance.now();
  try {
    const depth = Number($("#difficulty").value);
    const { bestMove, score } = await engine.search(game.fen(), depth);
    if (version !== gameVersion || mode !== GAME_MODES.BOT || game.turn() !== "b") return;
    searchApplied = true;
    const elapsed = (performance.now() - start) / 1000;
    blackTime = Math.max(0, blackTime - elapsed);
    if (blackTime <= 0) return endByClock("PLAYER");
    if (!bestMove || !game.moveUci(bestMove)) throw new Error("Stockfish tidak mengirim langkah yang valid.");
    gameVersion += 1;
    playTone(480);
    updateEvaluation(score, "b");
    saveState();
    renderBoard();
    if (!finishIfNeeded()) {
      setStatus("Giliran Anda", game.isCheck() ? "Raja putih sedang diskak." : "Pilih bidak putih untuk melangkah.");
    }
  } catch (error) {
    console.error(error);
    setStatus("Engine bermasalah", describeEngineError(error));
  } finally {
    thinking = false;
    document.body.classList.remove("thinking");
    boardElement.setAttribute("aria-busy", "false");
    renderTimers();
    if (!searchApplied && (version !== gameVersion || startingMode !== mode)) resumeModeFlow();
  }
}

async function analyzePosition(force = false) {
  if (
    mode !== GAME_MODES.ANALYSIS
    || !gameStarted
    || !engineReady
    || thinking
    || analysisBusy
    || gameEnded
  ) return;

  const fen = game.fen();
  if (!force && lastAnalyzedFen === fen) return;
  const version = gameVersion;
  const sideToMove = game.turn();
  analysisBusy = true;
  document.body.classList.add("analysis-thinking");
  boardElement.setAttribute("aria-busy", "true");
  $("#analysis-depth").textContent = `Menganalisis depth ${ANALYSIS_DEPTH}…`;
  updateAnalysisControls();
  setStatus("Menganalisis posisi…", "Stockfish menghitung langkah terbaik dan principal variation.");

  try {
    const { bestMove, score, depth, pv } = await engine.search(fen, ANALYSIS_DEPTH);
    if (version !== gameVersion || mode !== GAME_MODES.ANALYSIS || fen !== game.fen()) return;
    const pvUci = (pv?.length ? pv : bestMove ? [bestMove] : []).slice(0, PV_MAX_PLY);
    const pvSan = game.uciLineToSan(pvUci, PV_MAX_PLY);
    const bestSan = bestMove ? game.uciLineToSan([bestMove], 1)[0] : null;

    lastAnalyzedFen = fen;
    bestMoveSquares = uciToMove(bestMove);
    $("#best-move").textContent = bestSan || "Tidak ada langkah legal";
    $("#principal-variation").textContent = pvSan.length ? pvSan.join(" ") : "—";
    $("#analysis-depth").textContent = `Depth ${depth || ANALYSIS_DEPTH}`;
    updateEvaluation(score, sideToMove);
    setStatus(
      "Analisis siap",
      `Giliran ${game.turn() === "w" ? "putih" : "hitam"} — pilih bidak untuk melanjutkan.`,
    );
    renderBoard();
  } catch (error) {
    console.error(error);
    lastAnalyzedFen = "";
    $("#analysis-depth").textContent = "Analisis gagal";
    setStatus("Analisis gagal", describeEngineError(error));
  } finally {
    analysisBusy = false;
    document.body.classList.remove("analysis-thinking");
    boardElement.setAttribute("aria-busy", "false");
    updateAnalysisControls();
    if (version !== gameVersion || mode !== GAME_MODES.ANALYSIS || fen !== game.fen()) resumeModeFlow();
  }
}

function resumeModeFlow() {
  if (!engineReady || !gameStarted || gameEnded || thinking || analysisBusy) return;
  if (shouldBotMove(mode, game.turn())) {
    makeAiMove();
  } else if (mode === GAME_MODES.ANALYSIS) {
    analyzePosition();
  }
}

function finishIfNeeded() {
  const outcome = outcomeForCurrentMode();
  if (!outcome) return false;
  endGame(outcome);
  return true;
}

function outcomeForCurrentMode() {
  const outcome = game.outcome();
  if (!outcome || mode !== GAME_MODES.ANALYSIS || outcome.winner === "DRAW") return outcome;
  return {
    ...outcome,
    title: "Skakmat",
    detail: `Skakmat. ${game.turn() === "w" ? "Putih" : "Hitam"} tidak memiliki langkah legal.`,
  };
}

function endByClock(winner) {
  endGame(winner === "PLAYER"
    ? { winner, title: `${playerName || "Pemain"} menang!`, detail: "Waktu Stockfish habis." }
    : { winner, title: "Stockfish menang", detail: "Waktu pemain habis." });
}

function endGame(result) {
  gameEnded = true;
  thinking = false;
  saveState();
  setStatus(mode === GAME_MODES.ANALYSIS ? "Posisi selesai" : "Permainan selesai", result.detail);
  $("#result-title").textContent = mode === GAME_MODES.ANALYSIS
    ? (result.winner === "DRAW" ? "Posisi remis" : "Skakmat")
    : result.title;
  $("#result-detail").textContent = result.detail;
  if (mode === GAME_MODES.BOT && !resultDialog.open) resultDialog.showModal();
  updateAnalysisControls();
}

function setStatus(title, detail) {
  statusElement.textContent = title;
  statusDetail.textContent = detail;
}

function updateEvaluation(score, sideToMove) {
  if (!score) return;
  const direction = sideToMove === "w" ? 1 : -1;
  if (score.type === "mate") {
    const mate = score.value * direction;
    $("#evaluation").textContent = `${mate >= 0 ? "+" : "−"}M${Math.abs(mate)}`;
    $("#eval-fill").style.width = mate >= 0 ? "96%" : "4%";
    return;
  }
  const pawns = (score.value * direction) / 100;
  $("#evaluation").textContent = `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
  const percent = 50 + 46 * Math.tanh(pawns / 4);
  $("#eval-fill").style.width = `${percent}%`;
}

async function refreshEvaluation() {
  if (
    mode !== GAME_MODES.BOT
    || !gameStarted
    || !engineReady
    || thinking
    || analysisBusy
    || evaluationBusy
    || gameEnded
  ) return;
  const version = gameVersion;
  const fen = game.fen();
  evaluationBusy = true;
  try {
    const side = game.turn();
    const { score } = await engine.search(fen, 3);
    if (version === gameVersion && mode === GAME_MODES.BOT && fen === game.fen()) updateEvaluation(score, side);
  } catch (error) {
    console.debug("Evaluasi dilewati:", error.message);
  } finally {
    evaluationBusy = false;
  }
}

function tick(now) {
  const delta = (now - lastTick) / 1000;
  lastTick = now;
  if (
    modeUsesClock(mode)
    && gameStarted
    && engineReady
    && !gameEnded
    && !thinking
    && game.turn() === "w"
  ) {
    whiteTime = Math.max(0, whiteTime - delta);
    if (whiteTime <= 0) endByClock("AI");
  }
  renderTimers();
  requestAnimationFrame(tick);
}

function renderTimers() {
  $("#white-timer").textContent = formatTime(whiteTime);
  $("#black-timer").textContent = formatTime(blackTime);
}

function updateAnalysisControls() {
  $("#reanalyze").disabled = analysisBusy || thinking || gameEnded || !engineReady;
  $("#undo").disabled = analysisBusy || thinking || !game.history().length;
}

function playTone(frequency) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .1);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .11);
  } catch { /* Audio bersifat tambahan. */ }
}

function resetEvaluation() {
  $("#evaluation").textContent = "0.00";
  $("#eval-fill").style.width = "50%";
}

function restartGame() {
  gameVersion += 1;
  game.reset();
  whiteTime = START_SECONDS;
  blackTime = START_SECONDS;
  clearSelection();
  clearBestMove();
  gameEnded = false;
  if (resultDialog.open) resultDialog.close();
  resetEvaluation();
  saveState();
  renderBoard();
  renderTimers();
  if (!engineReady) {
    setStatus("Memuat engine…", "Stockfish WebAssembly sedang disiapkan.");
  } else if (mode === GAME_MODES.ANALYSIS) {
    setStatus("Menganalisis posisi…", "Stockfish menghitung posisi awal pada depth 12.");
    analyzePosition(true);
  } else {
    setStatus("Giliran Anda", "Pilih bidak putih untuk melangkah.");
  }
}

function undoMove() {
  if (mode !== GAME_MODES.ANALYSIS || analysisBusy || thinking) return;
  const undone = game.undo();
  if (!undone) return;
  gameVersion += 1;
  gameEnded = false;
  clearSelection();
  clearBestMove();
  if (resultDialog.open) resultDialog.close();
  resetEvaluation();
  saveState();
  renderBoard();
  setStatus("Langkah diurungkan", "Stockfish menganalisis kembali posisi sebelumnya.");
  analyzePosition(true);
}

function applyMode(nextMode, { initial = false } = {}) {
  const normalized = normalizeGameMode(nextMode);
  const changed = normalized !== mode;
  mode = normalized;
  if (changed && !initial) gameVersion += 1;
  clearSelection();
  clearBestMove();
  document.body.classList.toggle("analysis-mode", mode === GAME_MODES.ANALYSIS);
  analysisCard.hidden = mode !== GAME_MODES.ANALYSIS;
  const selectedMode = $(`input[name="game-mode"][value="${mode}"]`);
  if (selectedMode) selectedMode.checked = true;
  $("#black-avatar").textContent = mode === GAME_MODES.ANALYSIS ? "H" : "AI";
  $("#black-name").textContent = mode === GAME_MODES.ANALYSIS ? "Bidak hitam" : "Bot Kaprodi PGSD";
  $("#white-label").textContent = mode === GAME_MODES.ANALYSIS ? "Bidak putih · pengguna" : "Bidak putih";
  $("#name-description").textContent = mode === GAME_MODES.ANALYSIS
    ? "Anda dapat menggerakkan putih dan hitam sesuai giliran legal."
    : "Anda bermain sebagai putih melawan Stockfish.";
  boardElement.setAttribute(
    "aria-label",
    mode === GAME_MODES.ANALYSIS ? "Papan analisis catur" : "Papan catur melawan Stockfish",
  );
  if (resultDialog.open) resultDialog.close();
  saveState();
  renderBoard();
  renderTimers();

  if (!engineReady) {
    setStatus("Memuat engine…", "Stockfish WebAssembly sedang disiapkan.");
    return;
  }
  if (!gameStarted) {
    setStatus("Siap bermain", "Masukkan nama pemain untuk memulai.");
    return;
  }
  if (gameEnded) {
    setStatus(
      mode === GAME_MODES.ANALYSIS ? "Posisi selesai" : "Permainan selesai",
      outcomeForCurrentMode()?.detail || "",
    );
    return;
  }
  if (mode === GAME_MODES.ANALYSIS) {
    setStatus("Mode Analisis Catur", "Putih dan hitam dapat digerakkan sesuai giliran legal.");
    resumeModeFlow();
  } else if (game.turn() === "b") {
    setStatus("Melanjutkan permainan…", "Stockfish akan menjalankan langkah hitam.");
    resumeModeFlow();
  } else {
    setStatus("Giliran Anda", "Pilih bidak putih untuk melangkah.");
    refreshEvaluation();
  }
}

$("#restart").addEventListener("click", restartGame);
$("#play-again").addEventListener("click", restartGame);
$("#reanalyze").addEventListener("click", () => analyzePosition(true));
$("#undo").addEventListener("click", undoMove);
document.querySelectorAll('input[name="game-mode"]').forEach((input) => {
  input.addEventListener("change", () => applyMode(input.value));
});
$("#name-form").addEventListener("submit", () => {
  playerName = $("#name-input").value.trim() || "Pemain";
  gameStarted = true;
  $("#player-name").textContent = playerName;
  saveState();
  if (engineReady && !gameEnded) {
    if (mode === GAME_MODES.ANALYSIS) {
      setStatus("Mode Analisis Catur", "Putih dan hitam dapat digerakkan sesuai giliran legal.");
      analyzePosition(true);
    } else {
      setStatus("Giliran Anda", "Pilih bidak putih untuk melihat langkah legal.");
      refreshEvaluation();
    }
  }
});
nameDialog.addEventListener("cancel", (event) => event.preventDefault());
$("#difficulty").addEventListener("change", saveState);
window.addEventListener("beforeunload", saveState);

async function boot() {
  if (saved.difficulty && $("#difficulty").querySelector(`option[value="${saved.difficulty}"]`)) {
    $("#difficulty").value = saved.difficulty;
  }
  $("#player-name").textContent = playerName || "Pemain";
  applyMode(mode, { initial: true });
  renderTimers();
  requestAnimationFrame(tick);
  if (!playerName) nameDialog.showModal();
  try {
    await engine.init();
    engineReady = true;
    engineState.textContent = "Stockfish 18 · WebAssembly";
    updateAnalysisControls();
    if (gameEnded) {
      endGame(outcomeForCurrentMode());
    } else if (!gameStarted) {
      setStatus("Siap bermain", "Masukkan nama pemain untuk memulai.");
    } else if (mode === GAME_MODES.ANALYSIS) {
      setStatus("Mode Analisis Catur", "Putih dan hitam dapat digerakkan sesuai giliran legal.");
      await analyzePosition(true);
    } else if (game.turn() === "b") {
      setStatus("Melanjutkan permainan…", "Stockfish akan menjalankan langkah hitam.");
      await makeAiMove();
    } else {
      setStatus("Giliran Anda", "Pilih bidak putih untuk melihat langkah legal.");
      refreshEvaluation();
    }
  } catch (error) {
    console.error(error);
    engineState.textContent = "Stockfish gagal dimuat";
    setStatus("Engine gagal dimuat", describeEngineError(error));
  }
}

setInterval(saveState, 5000);
boot();
