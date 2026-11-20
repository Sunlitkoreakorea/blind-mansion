// 화면 위 글자와 창들
import { floorLabel, eul, iga, shuffle } from './util.js';
import { CARDS, CARD_MAP, MANUAL, TOP, BOTTOM } from './data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ELEV_FLOORS = (() => { const a = []; for (let f = TOP; f >= 1; f--) a.push(f); for (let f = -1; f >= BOTTOM; f--) a.push(f); return a; })();

export class UI {
  constructor() {
    this.panelKind = null;
    this.onKeyPanel = null;
    this.capT = 0;
    this.flashT = 0;
  }

  /* 첫 화면: 매뉴얼 */
  title(unlocked, onStart) {
    const t = $('#title');
    let mode = 'story';
    t.innerHTML = `
      <div class="manual">
        <div class="seal">Qterw-B-666</div>
        <h1>눈먼 자들의 저택</h1>
        ${MANUAL.map((p) => `<p>${esc(p)}</p>`).join('')}
        ${unlocked ? `<div class="modes"><button data-m="story" class="on">원작</button><button data-m="random">무작위</button></div>` : ''}
        <button class="read">다 읽었다</button>
        <div class="keys">WASD 이동 / Shift 달리기 / E 살펴보기 / F 양초 / Q 렌즈 / R 수리</div>
        ${matchMedia('(hover: none)').matches ? '<div class="keys">키보드와 마우스가 있는 PC에서 해 주세요</div>' : ''}
      </div>
      <div class="fan">팬이 만든 비공식 게임 / 원작 「괴담에 떨어져도 출근을 해야 하는구나」</div>`;
    t.hidden = false;
    t.querySelectorAll('.modes button').forEach((b) => b.onclick = () => {
      mode = b.dataset.m;
      t.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b));
    });
    t.querySelector('.read').onclick = () => onStart(mode);
  }
  hideTitle() { $('#title').hidden = true; $('#hud').hidden = false; }

  /* 상단과 하단 표시 */
  hud(s) {
    const mm = Math.floor(s.gameMin), hh = Math.floor(mm / 60), m2 = mm % 60;
    $('#watchTime').textContent = `${String(hh).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
    $('#watch').classList.toggle('late', s.gameMin >= 60);
    $('#floorLbl').textContent = floorLabel(s.floor);
    $('#memoRange').textContent = s.memo;
    $('#memo').classList.toggle('odd', s.memo === '???');
    const inv = [];
    if (s.tools) inv.push(`<span>정비 공구 ${s.tools}</span>`);
    if (s.kits) inv.push(`<span>양초 키트 ${s.kits}</span>`);
    $('#inv').innerHTML = inv.join('');
    $('#candle').innerHTML = s.candles.map((c) => `
      <div class="cd ${c.lit ? 'lit' : ''} ${c.ready ? '' : 'soft'}">
        <div class="cn">${esc(c.name)}</div>
        <div class="cs">${c.ready ? (c.lit ? '타는 중' : 'F 불 붙이기') : `굳는 중 ${Math.ceil(c.left)}분`}</div>
        ${c.ready ? `<div class="bar"><i style="width:${Math.round(c.wax * 100)}%"></i></div>` : ''}
      </div>`).join('');
    $('#body').innerHTML = s.parts.map((p) => `<div class="pt ${p.life > 0 ? '' : 'dead'}"><span>${esc(p.short)}</span><i style="width:${Math.round(Math.max(0, p.life) / 30 * 100)}%"></i></div>`).join('');
    $('#prompt').textContent = s.prompt || '';
    $('#prompt').classList.toggle('show', !!s.prompt);
    const ring = $('#holdRing');
    ring.style.strokeDashoffset = String(100 - Math.round((s.hold || 0) * 100));
    ring.parentElement.classList.toggle('show', (s.hold || 0) > 0);
    const st = $('#stam');
    st.style.width = `${Math.round(s.stamina * 100)}%`;
    st.parentElement.classList.toggle('show', s.stamina < 0.99);
    $('#lensCd').classList.toggle('show', s.lens !== null);
    if (s.lens !== null) $('#lensCd').style.setProperty('--p', s.lens);
  }

  caption(text, sec = 3) {
    const c = $('#caption');
    c.textContent = text;
    c.classList.add('show');
    this.capT = sec;
  }
  floorFlash(f) {
    const el = $('#floorFlash');
    el.textContent = floorLabel(f);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  tick(dt) {
    if (this.capT > 0) { this.capT -= dt; if (this.capT <= 0) $('#caption').classList.remove('show'); }
  }
  fade(a) { $('#fade').style.opacity = a; }

  eyes(l, r) {
    for (const [el, st] of [[$('#eyeL'), l], [$('#eyeR'), r]]) {
      el.className = 'eye-ov ' + (el.id === 'eyeL' ? 'left ' : 'right ') + st;
    }
  }

  // 징수 장면 덮개: 테두리 어둠, 번쩍임, 도장, 영수증 줄
  collectShow(l1, l2, l3) {
    const c = $('#collect');
    c.innerHTML = `<div class="vig"></div><div class="flash"></div><div class="stamp">${esc(l1)}</div><div class="c2">${esc(l2)}</div><div class="c3">${esc(l3)}</div>`;
    c.hidden = false;
    this.col = { c, vig: c.querySelector('.vig'), flash: c.querySelector('.flash'), stamp: c.querySelector('.stamp'), c2: c.querySelector('.c2'), c3: c.querySelector('.c3') };
  }
  collectFx({ alpha, vig, flash, flashColor, stamp, sub, count }) {
    const k = this.col;
    if (!k) return;
    k.c.style.opacity = alpha;
    k.vig.style.opacity = vig;
    k.flash.style.opacity = flash;
    k.flash.style.background = flashColor;
    const e = 1 - stamp;
    k.stamp.style.opacity = Math.min(1, stamp * 3);
    k.stamp.style.transform = `translate(-50%, -50%) rotate(-7deg) scale(${(1 + 1.8 * e * e * e).toFixed(3)})`;
    k.c2.style.opacity = sub;
    k.c3.style.opacity = count;
  }
  collectHide() { $('#collect').hidden = true; this.col = null; }

  pause(show, onResume) {
    const p = $('#pause');
    p.hidden = !show;
    if (show) {
      p.innerHTML = `<div class="box"><div class="pt">잠시 멈춤</div><button class="go">계속 관람</button><div class="keys">WASD 이동 / Shift 달리기 / E 살펴보기 / F 양초 / Q 렌즈 / R 수리 / 오른쪽 클릭 줌</div></div>`;
      p.querySelector('.go').onclick = onResume;
    }
  }

  ending(e, stats, onAgain) {
    const el = $('#ending');
    el.innerHTML = `<div class="box">
      <div class="et">${esc(e.title)}</div>
      ${e.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      <div class="stats">${stats.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <button class="go">다시 관람하기</button></div>`;
    el.hidden = false;
    $('#hud').hidden = true;
    el.querySelector('.go').onclick = onAgain;
  }

  /* 가운데 창 */
  open(kind, html, onKey) {
    const p = $('#panel');
    $('#panelBox').className = 'pn pn-' + kind;
    $('#panelBox').innerHTML = html;
    p.hidden = false;
    this.panelKind = kind;
    this.onKeyPanel = onKey || null;
    return $('#panelBox');
  }
  close() { $('#panel').hidden = true; this.panelKind = null; this.onKeyPanel = null; }
  get isOpen() { return !!this.panelKind; }
  key(code, e) { if (this.onKeyPanel) this.onKeyPanel(code, e); }

  elevator(cur, onGo, onClose) {
    let i = Math.max(0, ELEV_FLOORS.indexOf(cur));
    const box = this.open('elev', `
      <div class="lbl">층을 말씀하세요</div>
      <button class="st up" aria-label="위층">▲</button>
      <div class="big"></div>
      <button class="st dn" aria-label="아래층">▼</button>
      <div class="row"><button class="go">이동</button><button class="ghost x">닫기</button></div>`,
    (code) => {
      if (code === 'KeyW' || code === 'ArrowUp') move(-1);
      else if (code === 'KeyS' || code === 'ArrowDown') move(1);
      else if (code === 'Enter' || code === 'Space' || code === 'KeyE') go();
      else if (code === 'Escape') onClose();
    });
    const big = box.querySelector('.big');
    const render = () => { big.textContent = floorLabel(ELEV_FLOORS[i]); big.classList.toggle('here', ELEV_FLOORS[i] === cur); };
    const move = (d) => { i = Math.min(ELEV_FLOORS.length - 1, Math.max(0, i + d)); render(); };
    const go = () => onGo(ELEV_FLOORS[i]);
    box.querySelector('.up').onclick = () => move(-1);
    box.querySelector('.dn').onclick = () => move(1);
    box.querySelector('.go').onclick = go;
    box.querySelector('.x').onclick = onClose;
    box.addEventListener('wheel', (e) => { e.preventDefault(); move(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    render();
  }

  ask(onPick) {
    const qs = [
      ['up', '돌아가는 손님들은 이 층에서 위로 가나요?'],
      ['down', '돌아가는 손님들은 이 층에서 아래로 가나요?'],
      ['here', '돌아가는 손님들은 이 층에서 나가나요?'],
      ['way', '…층으로 가는 길을 알려 주세요.'],
      ['close', '그만 묻는다'],
    ];
    const box = this.open('ask', qs.map(([k, t], n) => `<button data-q="${k}" class="${k === 'close' ? 'ghost' : ''}"><em>${n + 1}</em>${esc(t)}</button>`).join(''),
      (code) => {
        const m = /^Digit([1-5])$/.exec(code);
        if (m) onPick(qs[+m[1] - 1][0]);
        else if (code === 'Escape') onPick('close');
      });
    box.querySelectorAll('button').forEach((b) => b.onclick = () => onPick(b.dataset.q));
  }

  keypad(onDone) {
    let digits = '', under = false;
    const box = this.open('pad', `
      <div class="disp"></div>
      <div class="sw"><button data-u="0" class="on">지상</button><button data-u="1">지하</button></div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '←', 0, '확인'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>
      <button class="ghost x">그만두기</button>`,
    (code) => {
      const m = /^(Digit|Numpad)(\d)$/.exec(code);
      if (m) press(m[2]);
      else if (code === 'Backspace') press('←');
      else if (code === 'Enter') press('확인');
      else if (code === 'Escape') onDone(null);
    });
    const disp = box.querySelector('.disp');
    const value = () => (digits === '' ? null : (under ? -1 : 1) * parseInt(digits, 10));
    const render = () => {
      const v = value();
      disp.textContent = v === null ? '__층' : floorLabel(v === 0 ? 0 : v);
      disp.classList.toggle('empty', v === null);
    };
    const press = (k) => {
      if (k === '←') digits = digits.slice(0, -1);
      else if (k === '확인') { const v = value(); if (v !== null) onDone(v === 0 ? 0 : v); return; }
      else if (digits.length < 4) digits = (digits === '0' ? '' : digits) + k;
      render();
    };
    box.querySelectorAll('.sw button').forEach((b) => b.onclick = () => {
      under = b.dataset.u === '1';
      box.querySelectorAll('.sw button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
    box.querySelectorAll('.keys button').forEach((b) => b.onclick = () => press(b.dataset.k));
    box.querySelector('.x').onclick = () => onDone(null);
    render();
  }

  note(n, onClose) {
    const box = this.open('note', `<div class="nt">${esc(n.title)}</div><div class="nb">${esc(n.text)}</div><button class="ghost x">접는다</button>`,
      (code) => { if (['Escape', 'KeyE', 'Enter', 'Space'].includes(code)) onClose(); });
    box.querySelector('.x').onclick = onClose;
  }

  confirm(text, yes, no, onYes, onNo) {
    const box = this.open('confirm', `<div class="ct">${esc(text)}</div><div class="row"><button class="y">${esc(yes)}</button><button class="ghost n">${esc(no)}</button></div>`,
      (code) => { if (code === 'Escape') onNo(); });
    box.querySelector('.y').onclick = onYes;
    box.querySelector('.n').onclick = onNo;
  }

  // 카드 두 장은 뒤집힌 채 뽑고, 남은 열 장 중 하나를 직접 고름
  craft(rnd, onMade, onCancel, solo) {
    const order = shuffle(CARDS.map((c) => c.k), rnd);
    const picked = [];
    const box = this.open('craft', `
      <div class="slots">
        <div class="slot" data-s="0"><span>목적</span><b></b></div>
        <div class="slot" data-s="1"><span>방식</span><b></b></div>
        <div class="slot" data-s="2"><span>본질</span><b></b></div>
      </div>
      <div class="cards">${order.map((k) => `<button class="card" data-k="${k}"><span class="back"></span><span class="face"><i>${CARD_MAP[k].sym}</i>${k}</span></button>`).join('')}</div>
      <div class="foot"><span class="hint">한 장 뽑기</span><button class="ghost x">그만두기</button></div>`,
    (code) => { if (code === 'Escape' && picked.length < 3) onCancel(); });
    const hint = box.querySelector('.hint');
    const setSlot = (i, k) => { const s = box.querySelector(`.slot[data-s="${i}"]`); s.classList.add('on'); s.querySelector('b').textContent = `${CARD_MAP[k].sym} ${k}`; };
    box.querySelector('.x').onclick = onCancel;
    box.querySelectorAll('.card').forEach((b) => b.onclick = () => {
      if (b.classList.contains('used') || picked.length >= 3) return;
      const k = b.dataset.k;
      if (picked.length < 2) {
        b.classList.add('flip', 'used');
        picked.push(k); setSlot(picked.length - 1, k);
        if (picked.length === 1) hint.textContent = '한 장 더';
        else {
          hint.textContent = '마지막 한 장은 직접 고른다';
          setTimeout(() => box.querySelectorAll('.card:not(.used)').forEach((c) => c.classList.add('flip', 'open')), 450);
        }
      } else if (b.classList.contains('open')) {
        picked.push(k); setSlot(2, k); b.classList.add('used');
        box.querySelectorAll('.card').forEach((c) => c.classList.add('done'));
        setTimeout(() => this.craftResult(picked, onMade, solo), 600);
      }
    });
  }

  craftResult(cards, onMade, solo) {
    const [a, b, c] = cards.map((k) => CARD_MAP[k]);
    const name = `${a.pw}의 ${c.en}`;
    const lie = cards.includes('거짓');
    const box = this.open('made', `
      <div class="kw">${cards.map((k) => `<span>[${k}]</span>`).join('')}</div>
      <div class="oath">촛불을 든 자는 [${a.k}]${eul(a.k)} 바라고, [${b.k}]에 기대어, [${c.k}]${iga(c.k)} 된다.</div>
      <div class="cname">${esc(name)}</div>
      <ul class="fx">
        <li>${esc(c.d)}</li>
        ${lie ? '<li>안내원에게 말을 걸 수 있음</li>' : '<li class="no">[거짓]이 없어 질문할 수 없음</li>'}
        ${cards.includes('명예') ? '<li>안내원이 덜 의심함</li>' : ''}
        ${solo ? '<li class="no">혼자 만들어 조금 약함</li>' : ''}
      </ul>
      <button class="go">종이를 접는다</button>`,
    (code) => { if (code === 'Enter' || code === 'KeyE') done(); });
    const done = () => onMade(cards, name);
    box.querySelector('.go').onclick = done;
  }
}
