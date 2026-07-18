import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_MODES,
  GameModel,
  canUserMove,
  formatTime,
  modeUsesClock,
  normalizeGameMode,
  outcomeFor,
  shouldBotMove,
  uciToMove,
} from "../js/game.js";
import { Chess } from "../assets/vendor/chess.js";
import { infoFromLine, scoreFromLine } from "../js/stockfish.js";

test("formatTime menjaga tampilan jam", () => {
  assert.equal(formatTime(600), "10:00");
  assert.equal(formatTime(9.2), "0:10");
  assert.equal(formatTime(-2), "0:00");
});

test("UCI move dapat dibaca dan input rusak ditolak", () => {
  assert.deepEqual(uciToMove("e7e8q"), { from: "e7", to: "e8", promotion: "q" });
  assert.equal(uciToMove("e9e4"), null);
});

test("skor UCI Stockfish dapat dibaca", () => {
  assert.deepEqual(scoreFromLine("info depth 8 score cp -37 nodes 100"), { type: "cp", value: -37 });
  assert.deepEqual(scoreFromLine("info depth 9 score mate 3 nodes 200"), { type: "mate", value: 3 });
});

test("info UCI membaca depth, skor, dan principal variation", () => {
  assert.deepEqual(
    infoFromLine("info depth 12 seldepth 18 score cp 31 nodes 1234 pv e2e4 e7e5 g1f3 b8c6"),
    {
      depth: 12,
      score: { type: "cp", value: 31 },
      pv: ["e2e4", "e7e5", "g1f3", "b8c6"],
    },
  );
  assert.deepEqual(infoFromLine("info depth 7 currmove e2e4"), { depth: 7, score: null, pv: [] });
  assert.equal(infoFromLine("bestmove e2e4"), null);
});

test("model memvalidasi langkah dan menyediakan target legal", () => {
  const game = new GameModel();
  assert.deepEqual(game.legalMoves("e2").map((move) => move.to).sort(), ["e3", "e4"]);
  assert.equal(game.move("e2", "e5"), null);
  assert.equal(game.move("e2", "e4").san, "e4");
  assert.equal(game.turn(), "b");
});

test("castling, en passant, dan promosi ditangani chess.js", () => {
  const castle = new GameModel();
  for (const uci of ["e2e4", "e7e5", "g1f3", "b8c6", "f1e2", "g8f6", "e1g1"]) assert.ok(castle.moveUci(uci));
  assert.equal(castle.piece("g1").type, "k");
  assert.equal(castle.piece("f1").type, "r");

  const enPassant = new GameModel();
  for (const uci of ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]) assert.ok(enPassant.moveUci(uci));
  assert.equal(enPassant.piece("d5"), undefined);

  const promotion = new Chess("8/P7/8/8/8/8/7k/5K2 w - - 0 1");
  assert.equal(promotion.move({ from: "a7", to: "a8", promotion: "n" }).promotion, "n");
});

test("PV UCI dikonversi ke SAN tanpa mengubah posisi utama", () => {
  const game = new GameModel();
  const originalFen = game.fen();
  assert.deepEqual(
    game.uciLineToSan(["e2e4", "e7e5", "g1f3", "b8c6"], 3),
    ["e4", "e5", "Nf3"],
  );
  assert.equal(game.fen(), originalFen);
  assert.deepEqual(game.history(), []);
});

test("undo mengembalikan langkah terakhir dan giliran", () => {
  const game = new GameModel();
  const originalFen = game.fen();
  game.moveUci("e2e4");
  assert.equal(game.turn(), "b");
  assert.equal(game.undo().san, "e4");
  assert.equal(game.fen(), originalFen);
  assert.equal(game.turn(), "w");
  assert.equal(game.undo(), null);
});

test("fungsi mode membatasi bot dan timer hanya pada mode Lawan Bot", () => {
  assert.equal(normalizeGameMode("tidak-valid"), GAME_MODES.BOT);
  assert.equal(normalizeGameMode(GAME_MODES.ANALYSIS), GAME_MODES.ANALYSIS);
  assert.equal(canUserMove(GAME_MODES.BOT, "w"), true);
  assert.equal(canUserMove(GAME_MODES.BOT, "b"), false);
  assert.equal(canUserMove(GAME_MODES.ANALYSIS, "w"), true);
  assert.equal(canUserMove(GAME_MODES.ANALYSIS, "b"), true);
  assert.equal(shouldBotMove(GAME_MODES.BOT, "b"), true);
  assert.equal(shouldBotMove(GAME_MODES.ANALYSIS, "b"), false);
  assert.equal(modeUsesClock(GAME_MODES.BOT), true);
  assert.equal(modeUsesClock(GAME_MODES.ANALYSIS), false);
});

test("checkmate dan stalemate menghasilkan hasil yang benar", () => {
  const mate = new Chess();
  for (const move of ["f3", "e5", "g4", "Qh4#"]) mate.move(move);
  assert.equal(outcomeFor(mate).winner, "AI");

  const stale = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(outcomeFor(stale).detail.startsWith("Stalemate"), true);
});
