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
        cell.appendChild(d);
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
  if (cpuPlays){
    startCpuMove();
  }
}

function startCpuMove(){
  cpuThinking = true;
  cpuTimer = 5;
  cpuTimeEl.textContent = cpuTimer;
  cpuInterval = setInterval(()=>{
    cpuTimer--;
    cpuTimeEl.textContent = cpuTimer;
    if (cpuTimer<=0){
      clearInterval(cpuInterval);
      doCpuMove();
    }
  },1000);
}

function doCpuMove(){
  // Simple CPU: pick the move that flips the most stones. If tie, random among best.
  clearInterval(cpuInterval);
  const moves = validMovesFor(turn);
  if (moves.length===0){ cpuThinking=false; nextTurn(); return }
  let best = [];
  let bestScore = -1;
  for (const [r,c] of moves){
    // simulate
    const copy = board.map(row=>row.slice());
    const score = simulateFlipCount(copy,turn,r,c);
    if (score>bestScore){ bestScore=score; best=[[r,c]] }
    else if (score===bestScore) best.push([r,c]);
  }
  const choice = best[Math.floor(Math.random()*best.length)];
  saveHistory();
  applyMove(turn, choice[0], choice[1]);
  kifu.push(`${posToCoord(choice[0],choice[1])} (${turn===1?'B':'W'})`);
  cpuThinking = false;
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
  history=[]; kifu=[]; cpuThinking=false;
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
