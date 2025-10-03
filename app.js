// シンプルなオセロ実装 (ブラウザ)
// - 8x8 盤
// - プレイヤー対 CPU
// - 先手選択、CPU の思考は最大5秒（ここでは簡易にランダム最良1手）
// - 打ち直し、棋譜

const boardEl = document.getElementById('board');
const turnEl = document.getElementById('turn');
const blackCountEl = document.getElementById('black-count');
const whiteCountEl = document.getElementById('white-count');
const kifuEl = document.getElementById('kifu');
const cpuTimeEl = document.getElementById('cpu-time');

const startBtn = document.getElementById('start');
const undoBtn = document.getElementById('undo');
const firstSelect = document.getElementById('first-player');

const SIZE = 8;
let board = []; // 0 empty, 1 black, 2 white
let turn = 1; // 1 black, 2 white
let history = [];
let kifu = [];
let cpuTimer = 5; // seconds per move
let cpuThinking = false;
let cpuInterval = null;
let lastCpuMove = null; // CPUの最後の手 [r, c]

// ===== 定石データベース =====
// 主要な定石のパターン（座標は0-based）
// 形式: { moves: [[r,c], ...], name: "定石名" }
const JOSEKI = [
  // 虎定石（Tiger）
  {
    moves: [[2,3], [2,2], [3,2], [2,4]],
    name: "虎"
  },
  // 兎定石（Rabbit）
  {
    moves: [[2,3], [2,2], [2,4], [3,2]],
    name: "兎"
  },
  // 牛定石（Buffalo）
  {
    moves: [[2,3], [2,4], [3,5], [4,5]],
    name: "牛"
  },
  // 鼠定石（Mouse）
  {
    moves: [[2,3], [2,2], [4,2], [3,2]],
    name: "鼠"
  },
  // 縦取り
  {
    moves: [[2,3], [2,2], [2,4]],
    name: "縦取り"
  },
  // 斜め取り
  {
    moves: [[2,3], [2,4], [2,2]],
    name: "斜め取り"
  }
];

// ===== 位置評価テーブル =====
// 角は最重要、C打ち（角の隣）は危険、辺は有利
const POSITION_WEIGHTS = [
  [100, -20, 10,  5,  5, 10, -20, 100],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [ 10,  -5,  3,  2,  2,  3,  -5,  10],
  [  5,  -5,  2,  1,  1,  2,  -5,   5],
  [  5,  -5,  2,  1,  1,  2,  -5,   5],
  [ 10,  -5,  3,  2,  2,  3,  -5,  10],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [100, -20, 10,  5,  5, 10, -20, 100]
];

function initBoard() {
  board = Array.from({length:SIZE}, () => Array(SIZE).fill(0));
  const m = SIZE/2 -1;
  board[m][m] = 2;
  board[m+1][m+1] = 2;
  board[m][m+1] = 1;
  board[m+1][m] = 1;
}

function render() {
  boardEl.innerHTML = '';
  // プレイヤーのターンかどうかを判定
  const humanIsBlack = (firstSelect.value === 'human');
  const isHumanTurn = (humanIsBlack && turn===1) || (!humanIsBlack && turn===2);
  const validMoves = isHumanTurn && !cpuThinking && !awaitingCpuFirst ? validMovesFor(turn) : [];

  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      const coord = document.createElement('div');
      coord.className='coord';
      coord.textContent = `${r+1}${String.fromCharCode(65+c)}`;
      cell.appendChild(coord);
      if (board[r][c]!==0){
        const d = document.createElement('div');
        d.className='disk ' + (board[r][c]===1? 'black':'white');
        // CPUの最後の手にハイライトを追加
        if (lastCpuMove && lastCpuMove[0]===r && lastCpuMove[1]===c) {
          d.classList.add('cpu-last-move');
        }
        cell.appendChild(d);
      } else if (validMoves.some(m => m[0]===r && m[1]===c)) {
        // 合法手の位置にヒントを表示
        const hint = document.createElement('div');
        hint.className='hint';
        cell.appendChild(hint);
      }
      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }
  const counts = countDisks();
  blackCountEl.textContent = counts[1];
  whiteCountEl.textContent = counts[2];
  turnEl.textContent = turn===1? '黒': '白';
  renderKifu();
}

function countDisks(){
  const counts = {0:0,1:0,2:0};
  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) counts[board[r][c]]++;
  return counts;
}

const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

function validMovesFor(player){
  const opp = player===1?2:1;
  const moves = [];
  for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++){
    if (board[r][c]!==0) continue;
    let ok=false;
    for (const [dr,dc] of DIRS){
      let rr=r+dr, cc=c+dc, found=false;
      while (rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && board[rr][cc]===opp){ found=true; rr+=dr; cc+=dc }
      if (found && rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && board[rr][cc]===player) { ok=true; break }
    }
    if (ok) moves.push([r,c]);
  }
  return moves;
}

function applyMove(player, r, c){
  const opp = player===1?2:1;
  const flips = [];
  for (const [dr,dc] of DIRS){
    let rr=r+dr, cc=c+dc, line=[];
    while (rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && board[rr][cc]===opp){ line.push([rr,cc]); rr+=dr; cc+=dc }
    if (line.length>0 && rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && board[rr][cc]===player){ flips.push(...line) }
  }
  if (flips.length===0) return false;
  board[r][c]=player;
  for (const [rr,cc] of flips) board[rr][cc]=player;
  return true;
}

function onCellClick(e){
  if (cpuThinking) return;
  const r = parseInt(e.currentTarget.dataset.r,10);
  const c = parseInt(e.currentTarget.dataset.c,10);
  const moves = validMovesFor(turn);
  if (!moves.some(m=>m[0]===r && m[1]===c)) return;
  saveHistory();
  applyMove(turn,r,c);
  kifu.push(`${posToCoord(r,c)} (${turn===1?'B':'W'})`);
  nextTurn();
}

function nextTurn(){
  turn = turn===1?2:1;
  render();
  const moves = validMovesFor(turn);
  if (moves.length===0){
    const movesPrev = validMovesFor(turn===1?2:1);
    if (movesPrev.length===0){
      alert('ゲーム終了');
      return;
    } else {
      alert((turn===1?'黒':'白') + 'は合法手がありません。ターンをスキップします');
      turn = turn===1?2:1;
      render();
      // CPUのターンかどうか再確認
      const playerIsHumanFirst = firstSelect.value === 'human';
      const cpuPlays = playerIsHumanFirst? (turn===2) : (turn===1);
      if (cpuPlays && !awaitingCpuFirst){
        startCpuMove();
      }
      return;
    }
  }
  if (firstSelect.value === 'cpu' && turn===2) {
    // If player chose CPU as first, special rule: CPU's first move is chosen by player
  }
  // CPU move
  const isCpuTurn = (firstSelect.value === 'cpu' && turn===2) || (firstSelect.value==='human' && turn===1 && false);
  // For simplicity: CPU plays as white if firstSelect==='cpu'
  // We'll decide CPU side: if first-player select is 'cpu', CPU is black (先手)
  // adjust: CPU always plays opposite of player.
  const playerIsHumanFirst = firstSelect.value === 'human';
  const cpuPlays = playerIsHumanFirst? (turn===2) : (turn===1);
  if (cpuPlays && !awaitingCpuFirst){
    startCpuMove();
  }
}

function startCpuMove(){
  cpuThinking = true;
  cpuTimeEl.textContent = '思考中...';
  // 探索は即座に完了するので、少し遅延を入れてから実行
  setTimeout(() => {
    doCpuMove();
  }, 500); // 0.5秒の遅延で自然な動きに
}

function doCpuMove(){
  if (cpuInterval) {
    clearInterval(cpuInterval);
  }
  const moves = validMovesFor(turn);
  if (moves.length===0){ cpuThinking=false; nextTurn(); return }

  let choice = null;
  const emptyCount = countEmptySquares(board);

  // === 序盤：定石を使用 (最初の8手) ===
  if (kifu.length < 8) {
    const josekiMove = matchJoseki();
    if (josekiMove && moves.some(m => m[0] === josekiMove[0] && m[1] === josekiMove[1])) {
      choice = josekiMove;
      cpuTimeEl.textContent = '定石';
    }
  }

  // === 終盤：完全読み切り (残り10手以下) ===
  if (!choice && emptyCount <= 10) {
    const depth = Math.min(emptyCount, 10);
    const result = minimax(board, turn, depth, -Infinity, Infinity, true);
    if (result.move) {
      choice = result.move;
      cpuTimeEl.textContent = `完全読み(深さ${depth})`;
    }
  }

  // === 中盤：ミニマックス探索 (深さ4) ===
  if (!choice && emptyCount > 10 && emptyCount <= 50) {
    const result = minimax(board, turn, 4, -Infinity, Infinity, true);
    if (result.move) {
      choice = result.move;
      cpuTimeEl.textContent = '探索(深さ4)';
    }
  }

  // === フォールバック：評価関数ベースの選択 ===
  if (!choice) {
    let best = [];
    let bestScore = -Infinity;

    for (const [r, c] of moves) {
      const newBoard = applyMoveToBoard(board, turn, r, c);
      const score = evaluateBoard(newBoard, turn);

      if (score > bestScore) {
        bestScore = score;
        best = [[r, c]];
      } else if (score === bestScore) {
        best.push([r, c]);
      }
    }

    choice = best[Math.floor(Math.random() * best.length)];
    cpuTimeEl.textContent = '評価関数';
  }

  saveHistory();
  applyMove(turn, choice[0], choice[1]);
  kifu.push(`${posToCoord(choice[0],choice[1])} (${turn===1?'B':'W'})`);
  lastCpuMove = choice; // CPUの最後の手を記録
  cpuThinking = false;

  // 500ms後にcpuTimeElをクリア
  setTimeout(() => {
    cpuTimeEl.textContent = '-';
  }, 500);

  nextTurn();
}

function simulateFlipCount(bd, player, r, c){
  const opp = player===1?2:1;
  let flips = 0;
  for (const [dr,dc] of DIRS){
    let rr=r+dr, cc=c+dc, line=0;
    while (rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && bd[rr][cc]===opp){ line++; rr+=dr; cc+=dc }
    if (line>0 && rr>=0 && rr<SIZE && cc>=0 && cc<SIZE && bd[rr][cc]===player) flips+=line;
  }
  return flips;
}

// ===== 定石マッチング =====
function matchJoseki() {
  if (kifu.length > 8) return null; // 序盤のみ

  for (const joseki of JOSEKI) {
    if (kifu.length !== joseki.moves.length) continue;

    let match = true;
    for (let i = 0; i < joseki.moves.length; i++) {
      const [r, c] = joseki.moves[i];
      const coord = posToCoord(r, c);
      if (!kifu[i].includes(coord)) {
        match = false;
        break;
      }
    }

    if (match && joseki.moves[kifu.length]) {
      return joseki.moves[kifu.length]; // 次の一手を返す
    }
  }
  return null;
}

// ===== 評価関数 =====
function evaluateBoard(bd, player) {
  const opp = player === 1 ? 2 : 1;
  let score = 0;

  // 1. 位置評価
  let positionScore = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (bd[r][c] === player) {
        positionScore += POSITION_WEIGHTS[r][c];
      } else if (bd[r][c] === opp) {
        positionScore -= POSITION_WEIGHTS[r][c];
      }
    }
  }
  score += positionScore;

  // 2. 確定石（角）
  const corners = [[0,0], [0,7], [7,0], [7,7]];
  let cornerScore = 0;
  for (const [r, c] of corners) {
    if (bd[r][c] === player) cornerScore += 25;
    else if (bd[r][c] === opp) cornerScore -= 25;
  }
  score += cornerScore;

  // 3. 着手可能数（モビリティ）
  const playerMoves = validMovesForBoard(bd, player).length;
  const oppMoves = validMovesForBoard(bd, opp).length;
  score += (playerMoves - oppMoves) * 5;

  return score;
}

// 指定した盤面での合法手を取得
function validMovesForBoard(bd, player) {
  const opp = player === 1 ? 2 : 1;
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (bd[r][c] !== 0) continue;
      let ok = false;
      for (const [dr, dc] of DIRS) {
        let rr = r + dr, cc = c + dc, found = false;
        while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] === opp) {
          found = true;
          rr += dr;
          cc += dc;
        }
        if (found && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && bd[rr][cc] === player) {
          ok = true;
          break;
        }
      }
      if (ok) moves.push([r, c]);
    }
  }
  return moves;
}

// 盤面に手を適用（シミュレーション用）
function applyMoveToBoard(bd, player, r, c) {
  const opp = player === 1 ? 2 : 1;
  const newBoard = bd.map(row => row.slice());
  newBoard[r][c] = player;

  for (const [dr, dc] of DIRS) {
    let rr = r + dr, cc = c + dc, line = [];
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && newBoard[rr][cc] === opp) {
      line.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    if (line.length > 0 && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && newBoard[rr][cc] === player) {
      for (const [flipR, flipC] of line) {
        newBoard[flipR][flipC] = player;
      }
    }
  }

  return newBoard;
}

// ===== ミニマックス探索（アルファベータ枝刈り） =====
function minimax(bd, player, depth, alpha, beta, maximizing) {
  const moves = validMovesForBoard(bd, player);

  // 終了条件
  if (depth === 0 || moves.length === 0) {
    return { score: evaluateBoard(bd, maximizing ? player : (player === 1 ? 2 : 1)), move: null };
  }

  let bestMove = null;

  if (maximizing) {
    let maxScore = -Infinity;
    for (const [r, c] of moves) {
      const newBoard = applyMoveToBoard(bd, player, r, c);
      const result = minimax(newBoard, player === 1 ? 2 : 1, depth - 1, alpha, beta, false);

      if (result.score > maxScore) {
        maxScore = result.score;
        bestMove = [r, c];
      }

      alpha = Math.max(alpha, maxScore);
      if (beta <= alpha) break; // ベータ枝刈り
    }
    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    for (const [r, c] of moves) {
      const newBoard = applyMoveToBoard(bd, player, r, c);
      const result = minimax(newBoard, player === 1 ? 2 : 1, depth - 1, alpha, beta, true);

      if (result.score < minScore) {
        minScore = result.score;
        bestMove = [r, c];
      }

      beta = Math.min(beta, minScore);
      if (beta <= alpha) break; // アルファ枝刈り
    }
    return { score: minScore, move: bestMove };
  }
}

// ゲームの残り空マス数を数える
function countEmptySquares(bd) {
  let count = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (bd[r][c] === 0) count++;
    }
  }
  return count;
}

function posToCoord(r,c){
  return `${r+1}${String.fromCharCode(65+c)}`;
}

function saveHistory(){
  history.push({board: board.map(row=>row.slice()), turn, kifu: kifu.slice()});
  if (history.length>60) history.shift();
}

undoBtn.addEventListener('click', ()=>{
  if (history.length===0 || cpuThinking) return;
  const last = history.pop();
  board = last.board.map(row=>row.slice());
  turn = last.turn;
  kifu = last.kifu.slice();
  render();
});

startBtn.addEventListener('click', ()=>{
  initBoard();
  history=[]; kifu=[]; cpuThinking=false; lastCpuMove=null; lastCpuMove=null;
  const first = firstSelect.value;
  // if CPU first, CPU is black
  // no special handling here - gameplay logic uses turn and first select
  turn = 1; // black starts
  render();
  // if CPU is first, we need to allow player to place CPU's first move? spec: "CPUが先手の場合、CPUの一手目をプレイヤーが指定する"
  if (first==='cpu'){
    alert('CPUが先手です。CPUの一手目を選んでください（プレイヤーが指定します）。');
    // We will treat next click as placing CPU's first move by allowing player to click any legal move and it will be applied as CPU's move.
    // To implement, we set a flag
    awaitingCpuFirst = true;
  } else {
    awaitingCpuFirst = false;
  }
});

let awaitingCpuFirst = false;

// Modify onCellClick to handle awaitingCpuFirst
const originalOnCellClick = onCellClick;
function onCellClick(e){
  if (cpuThinking) return;
  const r = parseInt(e.currentTarget.dataset.r,10);
  const c = parseInt(e.currentTarget.dataset.c,10);
  if (awaitingCpuFirst){
    // apply move as CPU on behalf
    const moves = validMovesFor(turn);
    if (!moves.some(m=>m[0]===r && m[1]===c)) return;
    saveHistory();
    applyMove(turn,r,c);
    kifu.push(`${posToCoord(r,c)} (CPU)`);
    lastCpuMove = [r, c]; // CPU初手を記録
    awaitingCpuFirst=false;
    nextTurn();
    return;
  }
  const moves = validMovesFor(turn);
  if (!moves.some(m=>m[0]===r && m[1]===c)) return;
  // human move
  // determine if this is actually human's turn: player may be black or white depending on firstSelect
  const humanIsBlack = (firstSelect.value === 'human');
  const humanPlays = (humanIsBlack && turn===1) || (!humanIsBlack && turn===2);
  if (!humanPlays) return; // ignore clicks when not human's turn

  lastCpuMove = null; // プレイヤーが手を打つ際、CPUの最後の手のハイライトをクリア
  saveHistory();
  applyMove(turn,r,c);
  kifu.push(`${posToCoord(r,c)} (${turn===1?'B':'W'})`);
  nextTurn();
}

render();

function renderKifu(){
  kifuEl.innerHTML='';
  for (let i=0;i<kifu.length;i++){
    const li = document.createElement('li');
    li.textContent = `${i+1}. ${kifu[i]}`;
    kifuEl.appendChild(li);
  }
}

// 初期レンダリング
initBoard(); render();
