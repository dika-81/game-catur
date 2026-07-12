import test from "node:test";
import assert from "node:assert/strict";
import { GameModel, formatTime, outcomeFor, uciToMove } from "../js/game.js";
import { Chess } from "../assets/vendor/chess.js";
import { scoreFromLine } from "../js/stockfish.js";

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

test("checkmate dan stalemate menghasilkan hasil yang benar", () => {
  const mate = new Chess();
  for (const move of ["f3", "e5", "g4", "Qh4#"]) mate.move(move);
  assert.equal(outcomeFor(mate).winner, "AI");

  const stale = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(outcomeFor(stale).detail.startsWith("Stalemate"), true);
});
