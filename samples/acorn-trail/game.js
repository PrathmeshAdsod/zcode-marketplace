const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const status = document.querySelector('#status');
const welcome = document.querySelector('#welcome');
const player = { x: 37, y: 201 };
const acorns = [{ x: 105, y: 201 }, { x: 221, y: 201 }, { x: 346, y: 201 }];
const keys = new Set();
const keyMap = { w: 'ArrowUp', a: 'ArrowLeft', s: 'ArrowDown', d: 'ArrowRight' };
let started = false;
let done = false;
let collected = 0;

function paint(color, x, y, width, height) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}
function polygon(color, points) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}
function tree(x, y, h, color, trunk = color) {
  const w = Math.ceil(h * .36);
  paint(trunk, x - 2, y - h / 2, 4, h / 2 + 3);
  for (let tier = 0; tier < 4; tier++) {
    const top = y - h + tier * h * .16;
    const half = w * (.44 + .17 * tier);
    polygon(color, [[x, top], [x + half, top + h * .42], [x - half, top + h * .42]]);
  }
}
let seed = 49;
function rand() {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const background = document.createElement('canvas');
background.width = 480;
background.height = 270;

function drawForest() {
  paint('#142738', 0, 0, 480, 270);
  paint('#1d3343', 0, 52, 480, 74);
  paint('#284653', 0, 117, 480, 62);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * 480), y = Math.floor(rand() * 150);
    paint(i % 6 === 0 ? '#eccd87' : '#86a8ab', x, y, i % 6 === 0 ? 2 : 1, 1);
  }
  for (let y = -25; y <= 25; y++) {
    const w = Math.floor(Math.sqrt(625 - y * y));
    paint(y > 14 ? '#c9af82' : '#f0d99f', 352 - w, 58 + y, 2 * w, 1);
  }
  paint('#d7bd8b', 342, 44, 13, 2);
  paint('#d7bd8b', 357, 66, 11, 2);
  polygon('#385763', [[0,144],[67,99],[113,132],[169,93],[246,147],[317,102],[376,135],[426,98],[480,137],[480,195],[0,195]]);
  polygon('#36575a', [[0,151],[68,142],[121,155],[194,121],[230,147],[290,143],[352,161],[410,130],[480,154],[480,215],[0,215]]);
  for (let x = -3; x < 493; x += 8) tree(x, 179 + rand() * 13, 21 + rand() * 24, '#2b4d4c');
  for (let x = 0; x < 494; x += 16) tree(x + rand() * 10, 192 + rand() * 11, 30 + rand() * 36, '#234344');
  polygon('#233d39', [[0,181],[74,179],[126,193],[193,180],[275,184],[340,175],[394,187],[480,174],[480,270],[0,270]]);
  polygon('#56634a', [[0,216],[48,191],[111,193],[181,200],[238,189],[297,199],[367,185],[428,188],[480,174],[480,228],[424,215],[373,215],[306,229],[241,221],[180,232],[104,216],[53,224],[0,244]]);
  polygon('#777657', [[0,222],[56,200],[109,199],[182,211],[233,198],[302,207],[370,193],[423,199],[480,185],[480,218],[420,208],[373,209],[301,221],[234,214],[180,224],[108,209],[58,217],[0,238]]);
  for (let i = 0; i < 300; i++) {
    const x = Math.floor(rand() * 480), y = 182 + Math.floor(rand() * 88);
    const color = y > 227 ? ['#304e40','#567353','#233c38'][i % 3] : ['#738062','#667454','#45604a'][i % 3];
    paint(color, x, y, 1 + rand() * 4, 1);
  }
  for (const [x, y, h] of [[6,211,101],[34,187,75],[66,185,50],[465,207,111],[435,184,61],[401,184,42],[22,272,100],[59,278,52],[446,275,72],[479,268,102]]) {
    tree(x, y, h, '#153237', '#263a30');
    tree(x + 2, y - 3, h * .88, '#1e4040', '#314234');
  }
  polygon('#233b3b', [[400,200],[414,179],[430,200]]);
  polygon('#c68455', [[397,200],[413,179],[422,200]]);
  polygon('#3f3a2d', [[404,200],[412,188],[417,200]]);
  paint('#414b3b', 385, 209, 17, 2);
  background.getContext('2d').drawImage(canvas, 0, 0);
}
function draw(time) {
  ctx.drawImage(background, 0, 0);
  const phase = Math.floor(time / 170) % 4;
  paint('#714d35', 388, 205, 10, 3);
  paint('#db8850', 390, 201 - phase % 2, 6, 5);
  paint('#f8ce75', 392, 199 + phase % 2, 2, 5);
  for (let i = 0; i < 20; i++) {
    const x = (29 + i * 79 + Math.sin(time / 1400 + i) * 7) % 461;
    const y = 160 + (i * 33 % 85) + Math.cos(time / 1600 + i) * 4;
    paint(i % 2 ? '#c1a660' : '#e3c37c', Math.floor(x), Math.floor(y), 1, 1);
  }
  for (const acorn of acorns) {
    if (acorn.gone) continue;
    const y = acorn.y - 5 - (phase === 1 ? 1 : 0);
    paint('#6d432f', acorn.x - 2, y + 1, 6, 5);
    paint('#e1ac5e', acorn.x - 1, y + 2, 4, 3);
    paint('#f0d487', acorn.x - 2, y, 6, 2);
    paint('#a87d4f', acorn.x + 1, y - 2, 1, 2);
  }
  const { x, y } = player;
  paint('#303b34', x - 7, y + 1, 17, 3);
  paint('#9e573b', x - 8, y - 5, 9, 5);
  paint('#de8c52', x - 6, y - 8, 8, 6);
  paint('#bf7046', x - 2, y - 8, 12, 9);
  paint('#d99156', x + 4, y - 12, 7, 8);
  paint('#d99156', x + 4, y - 14, 2, 4);
  paint('#f1cc94', x + 8, y - 7, 5, 3);
  paint('#202b2d', x + 9, y - 10, 1, 1);
  paint('#332e28', x, y - 1, 2, 4);
  paint('#332e28', x + 7, y - 1, 2, 4);
}
function start() {
  started = true;
  welcome.hidden = true;
  status.textContent = 'Acorns 0 / 3';
}
function step(time) {
  if (started && !done) {
    player.x = Math.min(459, Math.max(10, player.x + (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'))) * 2));
    player.y = Math.min(243, Math.max(187, player.y + (Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'))) * 2));
    for (const acorn of acorns) {
      if (!acorn.gone && Math.hypot(player.x - acorn.x, player.y - acorn.y) < 12) {
        acorn.gone = true;
        collected++;
        status.textContent = 'Acorns ' + collected + ' / 3' + (collected === 3 ? ' · Head to camp' : '');
      }
    }
    if (player.x > 410 && collected === 3) {
      done = true;
      status.textContent = 'Trail complete · 3 acorns delivered';
    }
  }
  draw(time);
  requestAnimationFrame(step);
}
drawForest();
requestAnimationFrame(step);
document.querySelector('#start').addEventListener('click', start);
window.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !started) start();
  const key = keyMap[event.key] || event.key;
  if (!key.startsWith('Arrow')) return;
  event.preventDefault();
  keys.add(key);
});
window.addEventListener('keyup', event => keys.delete(keyMap[event.key] || event.key));
window.addEventListener('blur', () => keys.clear());
document.querySelectorAll('[data-move]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    button.setPointerCapture(event.pointerId);
    if (!started) start();
    keys.add(button.dataset.move);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => keys.delete(button.dataset.move));
});

