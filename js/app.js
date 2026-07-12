import { GameModel, PIECES, START_SECONDS, formatTime } from "./game.js?v=20260712-2";
import { StockfishEngine, describeEngineError } from "./stockfish.js?v=20260712-2";

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#board");
const statusElement = $("#status");
const statusDetail = $("#status-detail");
const engineState = $("#engine-state");
const nameDialog = $("#name-dialog");
const resultDialog = $("#result-dialog");
const promotionDialog = $("#promotion-dialog");
const storageKey = "chess-ai-pgsd-state-v1";

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
let whiteTime = Number.isFinite(saved.whiteTime) ? saved.whiteTime : START_SECONDS;
let blackTime = Number.isFinite(saved.blackTime) ? saved.blackTime : START_SECONDS;
let selected = null;
let legalMoves = [];
let thinking = false;
let gameEnded = Boolean(game.outcome());
let engineReady = false;
let lastTick = performance.now();
let evaluationBusy = false;
let gameVersion = 0;
let gameStarted = Boolean(playerName);

function readSavedState() {
  try { return JSON.parse(sessionStorage.getItem(storageKey)) || {}; }
  catch { return {}; }
}

function saveState() {
  sessionStorage.setItem(storageKey, JSON.stringify({
    playerName,
    pgn: game.pgn(),
    whiteTime,
    blackTime,
    difficulty: $("#difficulty")?.value || "6",
  }));
}

function squareName(row, column) { return "abcdefgh"[column] + (8 - row); }

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
  boardElement.setAttribute("aria-busy", "false");
  renderHistory(history);
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
    item.innerHTML = `<span>${history[index].san}</span>${history[index + 1]?.san || ""}`;
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}

async function handleSquare(square) {
  if (!gameStarted || !engineReady || thinking || gameEnded || game.turn() !== "w") return;
  const piece = game.piece(square);
  if (!selected) {
    if (piece?.color === "w") selectSquare(square);
    return;
  }
  if (piece?.color === "w") {
    selectSquare(square);
    return;
  }
  const candidate = legalMoves.find((move) => move.to === square);
  if (!candidate) {
    selected = null;
    legalMoves = [];
    renderBoard();
    return;
  }
  const promotion = candidate.flags.includes("p") ? await choosePromotion() : "q";
  if (!promotion) return;
  const move = game.move(selected, square, promotion);
  selected = null;
  legalMoves = [];
  if (!move) return renderBoard();
  playTone(760);
  saveState();
  renderBoard();
  if (finishIfNeeded()) return;
  await makeAiMove();
}

function selectSquare(square) {
  selected = square;
  legalMoves = game.legalMoves(square);
  renderBoard();
}

function choosePromotion() {
  promotionDialog.returnValue = "";
  promotionDialog.showModal();
  return new Promise((resolve) => {
    promotionDialog.addEventListener("close", () => resolve(promotionDialog.returnValue || null), { once: true });
  });
}

async function makeAiMove() {
  const version = gameVersion;
  thinking = true;
  document.body.classList.add("thinking");
  setStatus("AI sedang berpikir…", "Stockfish menghitung langkah terbaik.");
  const start = performance.now();
  try {
    const depth = Number($("#difficulty").value);
    const { bestMove, score } = await engine.search(game.fen(), depth);
    if (version !== gameVersion) return;
    const elapsed = (performance.now() - start) / 1000;
    blackTime = Math.max(0, blackTime - elapsed);
    if (blackTime <= 0) return endByClock("PLAYER");
    if (!bestMove || !game.moveUci(bestMove)) throw new Error("Stockfish tidak mengirim langkah yang valid.");
    playTone(480);
    updateEvaluation(score, "b");
    saveState();
    renderBoard();
    if (!finishIfNeeded()) setStatus("Giliran Anda", game.isCheck() ? "Raja putih sedang diskak." : "Pilih bidak putih untuk melangkah.");
  } catch (error) {
    console.error(error);
    setStatus("Engine bermasalah", describeEngineError(error));
  } finally {
    thinking = false;
    document.body.classList.remove("thinking");
    renderTimers();
  }
}

function finishIfNeeded() {
  const outcome = game.outcome();
  if (!outcome) return false;
  endGame(outcome);
  return true;
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
  setStatus("Permainan selesai", result.detail);
  $("#result-title").textContent = result.title;
  $("#result-detail").textContent = result.detail;
  if (!resultDialog.open) resultDialog.showModal();
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
  if (!gameStarted || !engineReady || thinking || evaluationBusy || gameEnded) return;
  const version = gameVersion;
  evaluationBusy = true;
  try {
    const side = game.turn();
    const { score } = await engine.search(game.fen(), 3);
    if (version === gameVersion) updateEvaluation(score, side);
  } catch (error) {
    console.debug("Evaluasi dilewati:", error.message);
  } finally { evaluationBusy = false; }
}

function tick(now) {
  const delta = (now - lastTick) / 1000;
  lastTick = now;
  if (gameStarted && engineReady && !gameEnded && !thinking && game.turn() === "w") {
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

function restartGame() {
  gameVersion += 1;
  game.reset();
  whiteTime = START_SECONDS;
  blackTime = START_SECONDS;
  selected = null;
  legalMoves = [];
  gameEnded = false;
  $("#evaluation").textContent = "0.00";
  $("#eval-fill").style.width = "50%";
  saveState();
  renderBoard();
  renderTimers();
  setStatus(engineReady ? "Giliran Anda" : "Memuat engine…", engineReady ? "Pilih bidak putih untuk melangkah." : "Stockfish WebAssembly sedang disiapkan.");
}

$("#restart").addEventListener("click", restartGame);
$("#play-again").addEventListener("click", restartGame);
$("#name-form").addEventListener("submit", () => {
  playerName = $("#name-input").value.trim() || "Pemain";
  gameStarted = true;
  $("#player-name").textContent = playerName;
  saveState();
  if (engineReady && !gameEnded) {
    setStatus("Giliran Anda", "Pilih bidak putih untuk melihat langkah legal.");
    refreshEvaluation();
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
  renderBoard();
  renderTimers();
  requestAnimationFrame(tick);
  if (!playerName) nameDialog.showModal();
  try {
    await engine.init();
    engineReady = true;
    engineState.textContent = "Stockfish 18 · WebAssembly";
    if (gameEnded) endGame(game.outcome());
    else if (gameStarted) setStatus(game.turn() === "w" ? "Giliran Anda" : "Melanjutkan permainan…", "Pilih bidak putih untuk melihat langkah legal.");
    else setStatus("Siap bermain", "Masukkan nama pemain untuk memulai timer.");
    if (gameStarted && game.turn() === "b" && !gameEnded) await makeAiMove();
    else if (gameStarted) refreshEvaluation();
  } catch (error) {
    console.error(error);
    engineState.textContent = "Stockfish gagal dimuat";
    setStatus("Engine gagal dimuat", describeEngineError(error));
  }
}

setInterval(() => { saveState(); refreshEvaluation(); }, 5000);
boot();
