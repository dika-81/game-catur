import { Chess } from "../assets/vendor/chess.js";

export const START_SECONDS = 10 * 60;

export const PIECES = Object.freeze({
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
});

export function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function uciToMove(uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || "")) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

export function outcomeFor(game) {
  if (game.isCheckmate()) {
    return game.turn() === "w"
      ? { winner: "AI", title: "Stockfish menang", detail: "Skakmat. Raja putih tidak memiliki langkah legal." }
      : { winner: "PLAYER", title: "Anda menang!", detail: "Skakmat. Stockfish tidak memiliki langkah legal." };
  }
  if (game.isStalemate()) return { winner: "DRAW", title: "Remis", detail: "Stalemate: pemain yang mendapat giliran tidak memiliki langkah legal." };
  if (game.isThreefoldRepetition()) return { winner: "DRAW", title: "Remis", detail: "Posisi yang sama terulang tiga kali." };
  if (game.isInsufficientMaterial()) return { winner: "DRAW", title: "Remis", detail: "Materi tidak cukup untuk menghasilkan skakmat." };
  if (game.isDrawByFiftyMoves()) return { winner: "DRAW", title: "Remis", detail: "Aturan lima puluh langkah berlaku." };
  if (game.isDraw()) return { winner: "DRAW", title: "Remis", detail: "Permainan berakhir remis." };
  return null;
}

export class GameModel {
  constructor(pgn = "") {
    this.chess = new Chess();
    if (pgn) {
      try { this.chess.loadPgn(pgn); } catch { this.chess.reset(); }
    }
  }

  reset() { this.chess.reset(); }
  fen() { return this.chess.fen(); }
  pgn() { return this.chess.pgn(); }
  board() { return this.chess.board(); }
  history() { return this.chess.history({ verbose: true }); }
  turn() { return this.chess.turn(); }
  isCheck() { return this.chess.inCheck(); }
  outcome() { return outcomeFor(this.chess); }

  piece(square) { return this.chess.get(square); }

  legalMoves(square) {
    return this.chess.moves({ square, verbose: true });
  }

  move(from, to, promotion = "q") {
    try { return this.chess.move({ from, to, promotion }); }
    catch { return null; }
  }

  moveUci(uci) {
    const move = uciToMove(uci);
    return move ? this.move(move.from, move.to, move.promotion) : null;
  }
}
