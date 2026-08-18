#!/usr/bin/env bun
// pacing-test.mjs — headless pacing harness for the alchemy game.
//
// Loads the real <script> from index.html onto a minimal DOM stub with a
// seeded Math.random, then:
//   1. runs deterministic unit checks on the new feed/transmute economy, and
//   2. simulates a greedy player (solve puzzles, upgrade the crucible, buy
//      generators, transmute metals, buy techs) driving tick() by the second,
//      reporting milestone times and detecting soft-locks/stalls.
//
// Run:  bun run pacing-test.mjs [--runs N]
// Exit code 0 = all assertions pass.

import { readFileSync } from "node:fs";

const RUNS = (Number(process.argv.find(a => a.startsWith("--runs="))?.split("=")[1]) ||
  (process.argv.includes("--runs") ? Number(process.argv[process.argv.indexOf("--runs") + 1]) : 5));

// ---------- Seeded PRNG (mulberry32) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- DOM stub ----------
 function makeEnv(rand, sharedStore) {
   const byId = new Map();
   const timers = [];
   const store = sharedStore || new Map();

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.dataset = {};
      this._attrs = {};
      this._classes = new Set();
      this._innerHTML = "";
      this.style = {};
      this.onclick = null;
      this.disabled = false;
      this.checked = false;
      this._text = undefined;
      this.id = "";
      this._listeners = {};
    }
    get classList() {
      const self = this;
      return {
        add: (...n) => n.forEach(x => self._classes.add(x)),
        remove: (...n) => n.forEach(x => self._classes.delete(x)),
        toggle: (n, force) => {
          const want = force === undefined ? !self._classes.has(n) : !!force;
          want ? self._classes.add(n) : self._classes.delete(n);
          return want;
        },
        contains: n => self._classes.has(n),
      };
    }
    set innerHTML(html) {
      this._text = undefined;
      this._innerHTML = String(html);
      this.children = [];
      const re = /<(\w+)([^>]*)>/g;
      let m;
      while ((m = re.exec(this._innerHTML))) {
        const el = new El(m[1]);
        const idm = m[2].match(/id="([^"]+)"/);
        if (idm) { el.id = idm[1]; byId.set(idm[1], el); }
        if (/\bdisabled\b/.test(m[2])) el.disabled = true;
        this.children.push(el);
      }
    }
    get innerHTML() { return this._innerHTML; }
    set textContent(v) { this._text = String(v); this._innerHTML = ""; this.children = []; }
    get textContent() {
      if (this._text !== undefined) return this._text;
      return this._innerHTML ? this._innerHTML.replace(/<[^>]*>/g, "") : "";
    }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    closest(sel) { return sel === this.tagName.toLowerCase() ? this : null; }
    // Bubble like the real DOM: listeners on ancestors see the event too.
    fire(type, props = {}) {
      const ev = { target: this, button: 0, preventDefault() {}, ...props };
      let n = this;
      while (n) { for (const fn of n._listeners[type] || []) fn(ev); n = n.parent; }
    }
    click() { if (this.onclick) this.onclick(); }
  }

  const makeEl = (tag, id) => {
    const e = new El(tag);
    if (id) { e.id = id; byId.set(id, e); }
    return e;
  };

  // Static ids parsed from the real markup (outside the script).
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const markup = html.split("<script>")[0];
  for (const m of markup.matchAll(/id="([^"]+)"/g)) makeEl("div", m[1]);

  const winSub = makeEl("span", "__win-sub");
  const boardWrap = makeEl("div", "__board-wrap");

  const doc = {
    getElementById: id => byId.get(id) || null,
    createElement: tag => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
    querySelector: sel => (sel === ".board-wrap" ? boardWrap : sel === "#win-banner .win-sub" ? winSub : null),
    addEventListener() {},
    documentElement: { style: { setProperty() {} } },
    body: { style: {} },
    readyState: "complete",
  };
   const win = {
     _listeners: {},
     addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
     fire(type) { for (const fn of this._listeners[type] || []) fn({}); },
   };
  const ls = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  // Timers are captured, never fired: the harness drives time by hand.
  const setIntervalS = fn => { timers.push({ fn, interval: true }); return timers.length; };
  const setTimeoutS = fn => { timers.push({ fn }); return timers.length; };
  const clearTimeoutS = id => { if (timers[id]) timers[id].dead = true; };
  const math = new Proxy(Math, { get: (t, k) => (k === "random" ? rand : t[k]) });

  return { doc, win, ls, setIntervalS, setTimeoutS, clearTimeoutS, math, byId, timers };
}

// ---------- Game launch ----------
const SCRIPT_CACHE = (() => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error("no <script> block found in index.html");
  return m[1];
})();

const HOOK = `
;globalThis.__game = {
  get gameState() { return gameState; },
  get cells() { return cells; },
  get solution() { return solution; },
  get state() { return state; },
  get clues() { return clues; },
  get puzzleMoves() { return puzzleMoves; },
  get puzzleSeconds() { return puzzleSeconds; },
  get totalSeconds() { return totalSeconds; },
  celebrateMagnumOpus,
  setCell, startPuzzle, reportWin, tick, updateUI, updateDynamicUI,
  get amountEls() { return amountEls; },
  get buyButtons() { return buyButtons; },
  generatorCost, generatorRate,
  saveProgress, loadProgress,
  upgradeBoard, buyTech, transmute, buyGenerator, buyInscription, inscriptionCost,
  addInventory, canAfford, spend,
  ELEMENTS_BY_RADIUS, GENERATORS, TECHS, METAL_RECIPES, ELEMENT_RECIPES, MAX_RADIUS, LOCATIONS,
  CLUE, INSCRIPTION, trySolve,
};
`;

 function launchGame(seed, store) {
   const env = makeEnv(mulberry32(seed), store);
  const fn = new Function("document", "window", "localStorage", "setInterval", "setTimeout", "clearTimeout", "Math", "console", SCRIPT_CACHE + HOOK);
  fn(env.doc, env.win, env.ls, env.setIntervalS, env.setTimeoutS, env.clearTimeoutS, env.math, console);
  const G = globalThis.__game;
  if (!G) throw new Error("game script did not expose __game");
  return { G, env };
}

const amountOf = (G, id) => G.gameState.resources[id]?.amount ?? G.gameState.metals[id]?.amount ?? G.gameState.elements[id]?.amount ?? 0;

// ---------- Unit checks ----------
const checkResults = [];
function check(name, cond, detail = "") {
  checkResults.push({ name, pass: !!cond, detail });
}

function runUnitChecks() {
  // U1: painting a cell green feeds one prima.
  {
    const { G } = launchGame(1);
    const g = G.solution.findIndex(v => v === 1);
    const prima0 = G.gameState.resources.prima_materia.amount;
    G.setCell(g, 1);
    check("U1 feed costs 1 prima", G.gameState.resources.prima_materia.amount === prima0 - 1 && G.state[g] === 1);
  }
  // U2: un-feeding refunds.
  {
    const { G } = launchGame(1);
    const g = G.solution.findIndex(v => v === 1);
    const prima0 = G.gameState.resources.prima_materia.amount;
    G.setCell(g, 1);
    G.setCell(g, 0);
    check("U2 un-feeding refunds 1 prima", G.gameState.resources.prima_materia.amount === prima0 && G.state[g] === 0);
  }
  // U3: cannot feed without prima.
  {
    const { G } = launchGame(1);
    const g = G.solution.findIndex(v => v === 1);
    G.gameState.resources.prima_materia.amount = 0;
    const ok = G.setCell(g, 1);
    check("U3 no feed without prima", ok === false && G.state[g] === 0 && G.gameState.resources.prima_materia.amount === 0);
  }
  // U4: extractor produces via tick().
  {
    const { G } = launchGame(1);
    G.gameState.resources.prima_materia.amount = 15;
    G.buyGenerator("extractor");
    check("U4a extractor purchasable", G.gameState.generators.extractor === 1);
    const prima0 = G.gameState.resources.prima_materia.amount;
    G.tick(10);
    check("U4b tick produces income", G.gameState.resources.prima_materia.amount > prima0, `delta=${(G.gameState.resources.prima_materia.amount - prima0).toFixed(2)}`);
  }
  // U5: a solved R3 board releases earth only, at max(1, round(greens/10)),
  // with win feedback (banner, status, success glow).
  {
    const { G, env } = launchGame(1);
    const greens = G.solution.filter(v => v === 1).length;
    const per = Math.max(1, Math.round(greens / 10));
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    G.reportWin();
    const e = G.gameState.elements;
    check("U5a R3 solve marked", G.gameState.currentPuzzle.solved === true);
    check("U5b R3 yields earth only", e.earth.amount === per && e.water.amount === 0 && e.air.amount === 0 && e.fire.amount === 0, `earth=${e.earth.amount} expect=${per}`);
    check("U5c feed paid fully", G.gameState.resources.prima_materia.amount === 20 - greens, `prima=${G.gameState.resources.prima_materia.amount}`);
    check("U5d win feedback shown", env.doc.getElementById("status").className === "status-win"
      && env.doc.querySelector("#win-banner .win-sub").textContent.includes("prima fed")
      && env.doc.querySelector(".board-wrap").classList.contains("success"));
  }
  // U6: reveal is a peek — no inventory change.
  {
    const { G, env } = launchGame(1);
    const before = JSON.stringify({ p: G.gameState.resources, m: G.gameState.metals, e: G.gameState.elements });
    env.doc.getElementById("solve-board").click();
    const after = JSON.stringify({ p: G.gameState.resources, m: G.gameState.metals, e: G.gameState.elements });
    check("U6 reveal gives nothing", before === after && G.gameState.currentPuzzle.solved === true);
  }
  // U7: reset refunds all fed cells.
  {
    const { G, env } = launchGame(1);
    const greens = G.solution.map((v, i) => (v === 1 ? i : -1)).filter(i => i >= 0).slice(0, 2);
    for (const i of greens) G.setCell(i, 1);
    const prima0 = G.gameState.resources.prima_materia.amount;
    env.doc.getElementById("reset-board").click();
    check("U7 reset refunds feed", G.gameState.resources.prima_materia.amount === prima0 + greens.length && G.state.every(v => v === 0));
  }
  // U8: R4 releases earth and water.
  {
    const { G } = launchGame(2);
    G.gameState.upgrades.board_size.radius = 4;
    G.gameState.currentPuzzle.radius = 4;
    G.startPuzzle();
    const greens = G.solution.filter(v => v === 1).length;
    const per = Math.max(1, Math.round(greens / 10));
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    G.reportWin();
    const e = G.gameState.elements;
    check("U8 R4 yields earth+water", e.earth.amount === per && e.water.amount === per && e.air.amount === 0 && e.fire.amount === 0, `earth=${e.earth.amount} water=${e.water.amount} expect=${per}`);
  }
  // U9: forging the Philosopher's Stone raises the Magnum Opus overlay.
  {
    const { G, env } = launchGame(3);
    const gs = G.gameState;
    // Satisfy the whole chain's requirements and afford every cost at once.
    for (const pool of [gs.resources, gs.metals, gs.elements]) {
      for (const entry of Object.values(pool)) entry.amount = 100000;
    }
    for (const t of G.TECHS) G.buyTech(t.id);
    const banner = env.doc.getElementById("opus-banner");
    check("U9a stone complete", gs.techTree.philosophers_stone === true);
    check("U9b opus overlay shown", banner.classList.contains("show"));
    env.doc.getElementById("opus-continue").click();
    check("U9c continue dismisses overlay", !banner.classList.contains("show"));
  }
  // U10: Fast Mode is the primary, synchronized default.
  {
    const { G, env } = launchGame(11);
    check("U10 fast mode primary",
      G.gameState.settings.speedMode === true
      && env.doc.getElementById("speed-mode").checked === true
      && env.doc.getElementById("tRed").disabled === true);
  }
  // U11: location UI (id, title, body background) follows board + inscription.
  {
    const { G, env } = launchGame(11);
    const gs = G.gameState;
    const assertLoc = (id) => {
      const loc = G.LOCATIONS[id];
      return gs.currentLocationId === id
        && env.doc.getElementById("loc-title").textContent === loc.name
        && env.doc.body.style.backgroundColor === loc.bg;
    };
    check("U11a start at Leaden Chamber (R3)", assertLoc("leaden_chamber"));
    gs.resources.prima_materia.amount = 100000;
    G.upgradeBoard(); G.upgradeBoard();
    check("U11b Lunar Sanctum at R5 (cap)", gs.upgrades.board_size.radius === 5 && assertLoc("lunar_sanctum"));
    G.upgradeBoard();
    check("U11c radius capped at 5", gs.upgrades.board_size.radius === 5);
    gs.upgrades.inscription.level = 3; G.updateUI();
    check("U11d Solar Temple at R5 + inscription 3", assertLoc("solar_temple"));
    gs.upgrades.inscription.level = 6; G.updateUI();
    check("U11e Aetheric Vault at R5 + inscription 6", assertLoc("aetheric_vault"));
  }
  // U12: painting works through the real mouse-event path (click + drag).
  {
    const { G, env } = launchGame(11);
    const gs = G.gameState;
    const prima0 = gs.resources.prima_materia.amount;
    const board = env.byId.get("board");
    const polygons = board.children.filter(c => c.tagName === "POLYGON");
    check("U12a board rendered polygons", polygons.length === G.cells.length);
    const i = G.solution.findIndex(v => v === 1);
    const cell = idx => polygons.find(p => +p.dataset.idx === idx);
    cell(i).fire("mousedown", { button: 0 });
    env.win.fire("mouseup");
    check("U12b click paints green and feeds", G.state[i] === 1 && gs.resources.prima_materia.amount === prima0 - 1);
    // Drag from an empty cell: green tool starts "on" and stays on across the drag.
    const empties = G.solution.map((v, k) => (v === 0 ? k : -1)).filter(k => k >= 0);
    const [k, l] = empties;
    cell(k).fire("mousedown", { button: 0 }); // paints k green, dragApply=1
    cell(l).fire("mouseover");                // drag paints l green
    env.win.fire("mouseup");
    check("U12c drag paints both cells", G.state[k] === 1 && G.state[l] === 1
      && gs.resources.prima_materia.amount === prima0 - 3);
  }
  // U13: progress survives a save/load round trip (shared localStorage).
  {
    const store = new Map();
    const a = launchGame(13, store);
    const gs = a.G.gameState;
    gs.resources.prima_materia.amount = 5000;
    a.G.upgradeBoard();               // -> R4
    a.G.buyGenerator("extractor");    // level 1
    a.G.buyInscription();             // inscription level 1
    gs.resources.prima_materia.amount = 5000;
    gs.works = 5;
    a.G.transmute("metal", "lead");   // first metal
    a.G.saveProgress();
    const b = launchGame(14, store);
    const g2 = b.G.gameState;
    check("U13a radius restored", g2.upgrades.board_size.radius === 4);
    check("U13b generator restored", g2.generators.extractor === 1);
    check("U13c metal restored", g2.metals.lead.amount === 1, `got ${g2.metals.lead && g2.metals.lead.amount}`);
    check("U13d inscription restored", g2.upgrades.inscription.level === 1);
    check("U13e loaded puzzle starts pre-inscribed",
      g2.currentPuzzle.inscribed === Math.min(3, g2.currentPuzzle.removedTotal));
    check("U13f works counter restored", g2.works === 5);
  }
  // U14: the Check button flags mistakes and accepts a correct board.
  {
    const { G, env } = launchGame(17);
    const gs = G.gameState;
    const board = env.byId.get("board");
    const polyAt = idx => board.children.find(c => c.tagName === "POLYGON" && +c.dataset.idx === idx);
    const wrong = G.solution.findIndex(v => v === 0);
    G.setCell(wrong, 1); // paint a cell that is not in the solution
    env.doc.getElementById("check-board").click();
    check("U14a mistakes reported",
      env.doc.getElementById("status").textContent === "1 mistakes detected."
      && env.doc.getElementById("status").className === "status-err"
      && polyAt(wrong).classList.contains("bad"));
    env.doc.getElementById("reset-board").click();
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    env.doc.getElementById("check-board").click();
    check("U14b correct board wins via Check", gs.currentPuzzle.solved === true);
  }
  // U15: manual mode unlocks the red tool; right-click marks empty.
  {
    const { G, env } = launchGame(17);
    const gs = G.gameState;
    const speed = env.doc.getElementById("speed-mode");
    speed.checked = false;
    speed.onchange({ target: speed });
    check("U15a manual mode enables red tool",
      gs.settings.speedMode === false && env.doc.getElementById("tRed").disabled === false);
    const board = env.byId.get("board");
    const polyAt = idx => board.children.find(c => c.tagName === "POLYGON" && +c.dataset.idx === idx);
    const k = G.solution.findIndex(v => v === 0);
    polyAt(k).fire("mousedown", { button: 2 });
    env.win.fire("mouseup");
    check("U15b right-click marks empty in manual mode", G.state[k] === 2);
  }
  // U16: the upgrades section lists every option at once.
  {
    const { G, env } = launchGame(21);
    G.gameState.resources.prima_materia.amount = 100000;
    G.updateUI();
    const list = env.byId.get("upgrades-list");
    const html = list.children.map(c => c.innerHTML || c.textContent || "").join("\n");
    check("U16 upgrades section lists all options",
      !!env.doc.getElementById("btn-upgrade-board")
      && !!env.doc.getElementById("btn-inscribe")
      && !!env.doc.getElementById("btn-gen-extractor")
      && html.includes("Fire Furnace")
      && html.includes("Unlocks at crucible radius 5")
      && env.doc.getElementById("generators-list") === null,
      html.slice(0, 120));
  }
  // U17: inscription re-etches clues on the current board and future ones.
  {
    const { G } = launchGame(22);
    const gs = G.gameState;
    const clueCount = () => G.clues.filter(Boolean).length;
    const before = clueCount();
    gs.resources.prima_materia.amount = 100000;
    G.buyInscription();
    check("U17a inscription etches 3 clues", gs.upgrades.inscription.level === 1
      && gs.currentPuzzle.inscribed === 3 && clueCount() === before + 3);
    const solBefore = G.solution.join("");
    G.startPuzzle();
    check("U17b fresh puzzle starts pre-inscribed",
      gs.currentPuzzle.inscribed === Math.min(3, gs.currentPuzzle.removedTotal));
    gs.upgrades.board_size.radius = 5; gs.currentPuzzle.radius = 5;
    gs.upgrades.inscription.level = 3;
    G.startPuzzle();
    const kinds3 = new Set(G.clues.filter(Boolean).map(c => c.kind));
    check("U17c flow unlocks at inscription 3", kinds3.has(G.CLUE.FLOW) && kinds3.has(G.CLUE.SPEAR));
    gs.upgrades.inscription.level = 6;
    G.startPuzzle();
    const kinds6 = new Set(G.clues.filter(Boolean).map(c => c.kind));
    check("U17d all five forms at inscription 6", kinds6.size === 5, [...kinds6].join(","));
    check("U17e inscribed board stays deducible", G.trySolve(G.clues).res === "solved", `solChanged=${solBefore !== G.solution.join("") ? "yes" : "no"}`);
  }
  // U18: buy buttons flip enabled in real time as passive income accrues.
  {
    const { G, env } = launchGame(23);
    G.gameState.resources.prima_materia.amount = 14; // one tick short of 15
    G.updateUI();
    check("U18a button disabled while unaffordable", env.doc.getElementById("btn-gen-extractor").disabled === true);
    G.tick(1); G.updateUI();
    check("U18b still disabled at 14.5", env.doc.getElementById("btn-gen-extractor").disabled === true);
    G.tick(1); G.updateUI();
    check("U18c button enabled in real time at 15", env.doc.getElementById("btn-gen-extractor").disabled === false);
  }
  // U19: R5 (the cap) releases all four classical elements.
  {
    const { G } = launchGame(24);
    const gs = G.gameState;
    gs.upgrades.board_size.radius = 5; gs.currentPuzzle.radius = 5;
    G.startPuzzle();
    const greens = G.solution.filter(v => v === 1).length;
    const per = Math.max(1, Math.round(greens / 10));
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    G.reportWin();
    const e = G.gameState.elements;
    check("U19 R5 yields all four elements", e.earth.amount === per && e.water.amount === per
      && e.air.amount === per && e.fire.amount === per, `per=${per}`);
  }
  // U20: spear/flow badges track remaining need and flag forced moves.
  {
    const { G, env } = launchGame(25);
    const gs = G.gameState;
    gs.upgrades.board_size.radius = 5; gs.currentPuzzle.radius = 5;
    gs.resources.prima_materia.amount = 100000;
    G.startPuzzle();
    const board = env.byId.get("board");
    const badgeAt = idx => board.children.find(c => c.tagName === "TEXT" && c.classList.contains("clue-badge") && +c.dataset.idx === idx);
    const polyAt = idx => board.children.find(c => c.tagName === "POLYGON" && +c.dataset.idx === idx);
    const spear = G.clues.findIndex(c => c && c.kind === G.CLUE.SPEAR && c.count >= 2);
    check("U20a R5 has a multi-green spear clue", spear >= 0);
    const badge = badgeAt(spear);
    check("U20b badge present", !!badge);
    const clue = G.clues[spear];
    const expected = clue.count - clue.cells.filter(j => G.state[j] === 1).length;
    check("U20c badge shows remaining need", badge.textContent === String(expected), `text=${badge.textContent} expected=${expected}`);
    const k = clue.cells.find(j => G.solution[j] === 1 && G.state[j] === 0);
    G.setCell(k, 1);
    check("U20d badge tracks painting", badge.dataset.remaining === String(expected - 1));
    // Force a single unknown: red over every non-green in scope, keep one green.
    const t = clue.cells.find(j => G.solution[j] === 1 && G.state[j] !== 1);
    for (const j of clue.cells) if (G.solution[j] === 0 && G.state[j] !== 2) G.setCell(j, 2);
    for (const j of clue.cells) if (G.solution[j] === 1 && j !== t && G.state[j] !== 1) G.setCell(j, 1);
    check("U20e forced cell outlined", polyAt(t).classList.contains("forced"));
    check("U20f badge shows the last needed green", badge.dataset.remaining === "1");
  }
  // U21: fast mode — when a line/arrow clue has exactly one live tile left,
  // that tile is highlighted even though the other in-scope cells are only
  // proven non-green (faded, still state 0) rather than painted.
  {
    const { G, env } = launchGame(26);
    const gs = G.gameState;
    gs.upgrades.board_size.radius = 5; gs.currentPuzzle.radius = 5;
    gs.resources.prima_materia.amount = 100000;
    G.startPuzzle();
    const board = env.byId.get("board");
    const polyAt = idx => board.children.find(c => c.tagName === "POLYGON" && +c.dataset.idx === idx);
    // Find a flow/spear clue with a green t such that painting every other
    // green on the board leaves exactly one live tile (t) in its scope: all
    // other in-scope cells become proven red via the now-satisfied clues.
    let found = null;
    outer:
    for (const c of G.clues) {
      if (!c || (c.kind !== G.CLUE.SPEAR && c.kind !== G.CLUE.FLOW) || c.count === 0) continue;
      for (const t of c.cells) {
        if (G.solution[t] !== 1) continue;
        const red = new Array(G.cells.length).fill(false);
        for (const c2 of G.clues) {
          if (!c2 || c2.cells.includes(t)) continue;
          const g = c2.cells.filter(j => G.solution[j] === 1).length;
          if (g === c2.count) for (const j of c2.cells) if (G.solution[j] !== 1) red[j] = true;
        }
        const live = c.cells.filter(j => j === t || (G.solution[j] === 0 && !red[j]));
        if (live.length === 1) { found = { c, t }; break outer; }
      }
    }
    check("U21a one-tile-left situation exists on the board", !!found);
    if (found) {
      for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1 && i !== found.t) G.setCell(i, 1);
      check("U21b last tile outlined in fast mode", polyAt(found.t).classList.contains("forced"));
    }
  }
  // U22: coloured glyphs — inlined with real colours (no currentColor) and
  // per-icon gradient ids, so every url(#) ref resolves inside its own svg.
  {
    const { G, env } = launchGame(27);
    const htmlOf = el => el.children.map(c => (c._innerHTML || "") + c.children.map(g => g._innerHTML || "").join("")).join("");
    const ledger = htmlOf(env.byId.get("resource-list"));
    check("U22a ledger icons carry real colours", /#[0-9a-f]{6}/.test(ledger) && ledger.indexOf("currentColor") === -1);
    const transmute = htmlOf(env.byId.get("transmute-list"));
    const refs = [...transmute.matchAll(/url\(#([a-z0-9-]+)\)/g)].map(m => m[1]);
    const defs = [...transmute.matchAll(/linearGradient id="([a-z0-9-]+)"/g)].map(m => m[1]);
    check("U22b gradient refs resolve locally", refs.length >= 5 && refs.every(r => defs.includes(r)));
    check("U22c gradient ids are namespaced", defs.length >= 5 && defs.every(d => d.startsWith("g-")));
  }
  // U23: the per-second refresh updates amounts and button states in place
  // (node identity preserved); only a structural updateUI() rebuilds.
  {
    const { G, env } = launchGame(29);
    const gs = G.gameState;
    G.updateUI();
    const btnRef = env.doc.getElementById("btn-gen-extractor");
    const amt = G.amountEls.find(a => a.id === "prima_materia").el;
    gs.resources.prima_materia.amount = 9999;
    G.updateDynamicUI();
    check("U23a amount updated in place", amt.textContent === "9999");
    check("U23b button enabled in place", btnRef.disabled === false);
    check("U23c refresh keeps node identity", env.doc.getElementById("btn-gen-extractor") === btnRef);
    gs.resources.prima_materia.amount = 3;
    G.updateDynamicUI();
    check("U23d button disabled in place", btnRef.disabled === true);
    G.updateUI();
    check("U23e full render rebuilds nodes", env.doc.getElementById("btn-gen-extractor") !== btnRef);
  }
  // U24: the clue guide lists exactly the unlocked clue forms.
  {
    const { G, env } = launchGame(30);
    const gs = G.gameState;
    const guide = env.doc.getElementById("clue-guide");
    const names = () => guide.children.map(l => l.children[1].textContent);
    G.updateUI();
    check("U24a fresh game shows only surround", guide.children.length === 1 && names()[0].startsWith("Surround"));
    gs.upgrades.board_size.radius = 5; gs.currentPuzzle.radius = 5;
    gs.upgrades.inscription.level = 3;
    G.updateUI();
    check("U24b flow joins the guide at inscription 3", guide.children.length === 4 && names().some(t => t.startsWith("Flow")));
    gs.upgrades.inscription.level = 6;
    G.updateUI();
    check("U24c all five forms at R5 + inscription 6", guide.children.length === 5 && names().some(t => t.startsWith("Mirror")));
  }
  // U25: affordable buttons flash in place; the works counter renders and
  // increments on a win (and persists via save/load).
  {
    const { G, env } = launchGame(31);
    const gs = G.gameState;
    G.updateUI();
    const btn = env.doc.getElementById("btn-gen-extractor");
    check("U25a fresh render has no flash", !btn.classList.contains("just-affordable"));
    gs.resources.prima_materia.amount = 10;
    G.updateDynamicUI();
    check("U25b unaffordable disables in place", btn.disabled === true);
    gs.resources.prima_materia.amount = 9999;
    G.updateDynamicUI();
    check("U25c affordable transition flashes in place", btn.disabled === false && btn.classList.contains("just-affordable"));
    gs.resources.prima_materia.amount = 3;
    G.updateDynamicUI();
    check("U25d flash cleared when unaffordable again", btn.disabled === true && !btn.classList.contains("just-affordable"));
    gs.works = 7;
    G.updateUI();
    check("U25e works counter renders", env.doc.getElementById("works-count").textContent === "Works completed: 7");
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    G.reportWin();
    check("U25f winning increments works", gs.works === 8 && env.doc.getElementById("works-count").textContent === "Works completed: 8");
  }
  // U26: the clue-progress chip counts satisfied clues live.
  {
    const { G, env } = launchGame(32);
    const chip = env.doc.getElementById("clue-progress");
    const total = G.clues.filter(Boolean).length;
    check("U26a chip starts at 0/N", total > 0 && chip.textContent === `0/${total}`);
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    check("U26b solved board reads N/N", chip.textContent === `${total}/${total}`);
  }
  // U27: fresh board states the goal; the win banner reports moves used.
  {
    const { G, env } = launchGame(33);
    check("U27a fresh status states the goal", env.doc.getElementById("status").textContent.includes("clue"));
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    const moves = G.state.filter(v => v === 1).length;
    G.reportWin();
    const sub = env.doc.querySelector("#win-banner .win-sub");
    check("U27b win banner shows moves used", moves > 0 && sub.textContent.includes(`${moves} moves`));
  }
  // U28: Reveal states its cost and forfeits the yield (no works, no win).
  {
    const { G, env } = launchGame(34);
    const before = G.gameState.works;
    env.doc.getElementById("solve-board").click();
    check("U28a reveal forfeits the yield", G.gameState.currentPuzzle.solved && G.gameState.works === before);
    check("U28b reveal states the cost", env.doc.getElementById("status").textContent.includes("no yield"));
  }
  // U31: a paint updates the ledger in place — no rebuild, buttons flip
  // the instant the amount crosses a cost.
  {
    const { G, env } = launchGame(36);
    const gs = G.gameState;
    G.updateUI();
    const primaAmt = G.amountEls.find(a => a.id === "prima_materia").el;
    const btn = env.doc.getElementById("btn-gen-extractor"); // cost 15
    gs.resources.prima_materia.amount = 15;
    G.updateDynamicUI();
    check("U31a button affordable at exact cost", btn.disabled === false);
    const solIdx = G.solution.findIndex(v => v === 1);
    check("U31b board has a green to paint", solIdx >= 0);
    G.setCell(solIdx, 1);
    check("U31c paint updates the amount in place", primaAmt.textContent === "14");
    check("U31d node identity survives a paint", G.amountEls.find(a => a.id === "prima_materia").el === primaAmt);
    check("U31e button flips disabled immediately", btn.disabled === true);
  }
  // U30: a location unlock announces itself exactly once, at the change.
  {
    const { G, env } = launchGame(35);
    const gs = G.gameState;
    const status = () => env.doc.getElementById("status").textContent;
    gs.upgrades.board_size.radius = 4; gs.currentPuzzle.radius = 4;
    G.updateUI();
    check("U30a location advances to the forge", gs.currentLocationId === "martial_forge");
    check("U30b unlock is announced", status().includes("Martial Forge"));
    gs.resources.prima_materia.amount = 0;
    G.buyGenerator("extractor");
    G.updateUI();
    check("U30c no re-announce while unchanged", status().includes("Not enough Prima Materia"));
    gs.upgrades.board_size.radius = 5; gs.currentPuzzle.radius = 5;
    gs.upgrades.inscription.level = 3;
    G.updateUI();
    check("U30d inscription gate opens the temple", gs.currentLocationId === "solar_temple" && status().includes("Solar Temple"));
  }
  // U32: an in-progress board (paint, clues, spent economy) survives a
  // save/load round trip; a fresh launch still generates.
  {
    const store = new Map();
    const a = launchGame(37, store);
    const gs = a.G.gameState;
    const greens = [];
    for (let i = 0; i < a.G.cells.length; i++) if (a.G.solution[i] === 1) greens.push(i);
    const half = greens.slice(0, Math.floor(greens.length / 2));
    for (const i of half) a.G.setCell(i, 1);
    const primaAfterPaint = gs.resources.prima_materia.amount;
    a.G.saveProgress();
    const b = launchGame(38, store);
    check("U32a solution restored", b.G.solution.join(",") === a.G.solution.join(","));
    check("U32b paint restored", b.G.state.filter(v => v === 1).length === half.length);
    check("U32c clues restored", b.G.clues.filter(Boolean).length === a.G.clues.filter(Boolean).length);
    check("U32d economy matches the restored board", b.G.gameState.resources.prima_materia.amount === primaAfterPaint);
    const c = launchGame(39);
    check("U32e fresh launch still generates", c.G.solution.length === c.G.cells.length && c.G.clues.some(clue => clue));
  }
  // U33: halo clues carry the same live badge + forced outline as the
  // line/arrow clues.
  {
    const { G, env } = launchGame(40);
    const gs = G.gameState;
    gs.upgrades.board_size.radius = 4; gs.currentPuzzle.radius = 4;
    gs.resources.prima_materia.amount = 100000;
    G.startPuzzle();
    const board = env.byId.get("board");
    const polyAt = idx => board.children.find(c => c.tagName === "POLYGON" && +c.dataset.idx === idx);
    const badgeAt = idx => board.children.find(c => c.tagName === "TEXT" && c.classList.contains("clue-badge") && +c.dataset.idx === idx);
    const halo = G.clues.findIndex(c => c && c.kind === G.CLUE.HALO);
    check("U33a R4 board has a halo clue", halo >= 0);
    check("U33b halo clue carries a badge", Boolean(badgeAt(halo)));
    let found = null;
    outer:
    for (let i = 0; i < G.clues.length; i++) {
      const c = G.clues[i];
      if (!c || c.kind !== G.CLUE.HALO || c.count === 0) continue;
      for (const t of c.cells) {
        if (G.solution[t] !== 1) continue;
        const red = new Array(G.cells.length).fill(false);
        for (const c2 of G.clues) {
          if (!c2 || c2.cells.includes(t)) continue;
          const g = c2.cells.filter(j => G.solution[j] === 1).length;
          if (g === c2.count) for (const j of c2.cells) if (G.solution[j] !== 1) red[j] = true;
        }
        const live = c.cells.filter(j => j === t || (G.solution[j] === 0 && !red[j]));
        if (live.length === 1) { found = { i, c, t }; break outer; }
      }
    }
    check("U33c one-tile-left halo situation exists", !!found);
    if (found) {
      for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1 && i !== found.t) G.setCell(i, 1);
      check("U33d last halo tile outlined", polyAt(found.t).classList.contains("forced"));
      check("U33e badge shows the last needed green", badgeAt(found.i).dataset.remaining === "1");
    }
  }
  // U34: the move count is live on the chip row, survives a save round
  // trip, and resets on a new puzzle.
  {
    const store = new Map();
    const { G, env } = launchGame(41, store);
    const chip = env.byId.get("move-count");
    check("U34a fresh board shows 0 moves", G.puzzleMoves === 0 && chip.textContent === "0 moves");
    const greens = [];
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) greens.push(i);
    G.setCell(greens[0], 1); G.setCell(greens[1], 1);
    check("U34b paints count live", G.puzzleMoves === 2 && chip.textContent === "2 moves");
    G.saveProgress();
    const b = launchGame(42, store);
    const bChip = b.env.byId.get("move-count");
    check("U34c move count survives a refresh", b.G.puzzleMoves === 2 && bChip.textContent === "2 moves");
    b.G.startPuzzle();
    check("U34d new puzzle resets the count", b.G.puzzleMoves === 0 && bChip.textContent === "0 moves");
  }
  // U35: the solve timer counts board time, freezes on solve, and is
  // reported on the win banner.
  {
    const { G, env } = launchGame(43);
    const chip = env.byId.get("solve-time");
    check("U35a timer starts at zero", G.puzzleSeconds === 0 && chip.textContent === "0m 0s");
    G.tick(42); G.updateDynamicUI();
    check("U35b timer counts board time", G.puzzleSeconds === 42 && chip.textContent === "0m 42s");
    G.tick(130); G.updateDynamicUI();
    check("U35c timer formats minutes", G.puzzleSeconds === 172 && chip.textContent === "2m 52s");
    for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
    G.reportWin();
    const banner = env.doc.querySelector("#win-banner .win-sub");
    check("U35d win banner reports the solve time", /2m 52s/.test(banner.textContent));
    G.tick(60);
    check("U35e timer freezes after the solve", G.puzzleSeconds === 172);
  }
  // U36: the Magnum Opus banner reports the span of the work — elapsed
  // play time and completed boards.
  {
    const { G, env } = launchGame(44);
    const gs = G.gameState;
    gs.works = 3;
    for (const pool of [gs.resources, gs.metals, gs.elements]) {
      for (const entry of Object.values(pool)) entry.amount = 100000;
    }
    G.tick(125); G.updateDynamicUI();
    check("U36a session clock counts", G.totalSeconds === 125);
    for (const t of G.TECHS) G.buyTech(t.id);
    const sub = env.byId.get("opus-sub");
    check("U36b opus reports time and works", sub.textContent.includes("2m 5s") && sub.textContent.includes("3 boards"));
  }
}

// ---------- Pacing simulation ----------
const SOLVE_TIME = { 3: 90, 4: 110, 5: 130 }; // seconds to solve a bare board, per radius
const INSC_FACTOR = 0.95;  // each etched clue multiplies the solve time
const INSC_MIN = 30;       // floor for the solve time, seconds
const MAX_T = 7200;          // 120 min sim cap
const STALL_SECONDS = 600;   // no progress for 10 min => soft-lock suspicion

function snapshot(G) {
  const g = G.gameState;
  return {
    radius: g.upgrades.board_size.radius,
    inscription: g.upgrades.inscription.level,
    prima: Math.floor(g.resources.prima_materia.amount),
    generators: { ...g.generators },
    elements: Object.fromEntries(Object.entries(g.elements).map(([k, v]) => [k, Math.floor(v.amount)])),
    metals: Object.fromEntries(Object.entries(g.metals).map(([k, v]) => [k, Math.floor(v.amount)])),
    techs: Object.keys(g.techTree),
  };
}

 // Transmute `id` until we hold `need`, first ensuring its own ingredients
 // (recursively down the metal chain). Elements come from puzzles, not here.
 function prepMetal(G, id, need, mark, t) {
   const recipe = G.METAL_RECIPES[id];
   if (!recipe) return false;
   let acted = false;
   for (const [rid, n] of Object.entries(recipe.cost)) {
     if (rid === "prima_materia") continue;
     if (G.METAL_RECIPES[rid] && amountOf(G, rid) < n && prepMetal(G, rid, n, mark, t)) acted = true;
     else if (rid === "quintessence" && amountOf(G, rid) < n && prepQuintessence(G, n, mark, t)) acted = true;
   }
   let guard = 0;
   while (amountOf(G, id) < need && guard++ < 100) {
     const before = amountOf(G, id);
     G.transmute("metal", id);
     if (amountOf(G, id) === before) break; // unaffordable right now
     acted = true;
     mark(`first ${id}`, t);
   }
   return acted;
 }

 function prepQuintessence(G, need, mark, t) {
   let guard = 0, acted = false;
   while (amountOf(G, "quintessence") < need && guard++ < 100) {
     const before = amountOf(G, "quintessence");
     G.transmute("element", "quintessence");
     if (amountOf(G, "quintessence") === before) break;
     acted = true;
     mark("first quintessence", t);
   }
   return acted;
 }

function simulate(seed) {
  const { G } = launchGame(seed);
  let lastSolveAt = -1e9;
  let lastProgress = 0;
  const milestones = {};
  const mark = (name, t) => { if (!(name in milestones)) milestones[name] = t; };
  let stall = null;

  for (let t = 0; t < MAX_T; t++) {
    G.tick(1);
    const gs = G.gameState;
    const radius = gs.upgrades.board_size.radius;
    const inscribed = Math.min(gs.upgrades.inscription.level * G.INSCRIPTION.step, 60);
    const solveTime = Math.max(INSC_MIN, Math.round(SOLVE_TIME[radius] * Math.pow(INSC_FACTOR, inscribed)));

    // 1) Solve the current puzzle when the player is ready and can afford the feed.
    if (!gs.currentPuzzle.solved && t - lastSolveAt >= solveTime) {
      const greens = G.solution.filter(v => v === 1).length;
      if (gs.resources.prima_materia.amount >= greens) {
        for (let i = 0; i < G.cells.length; i++) if (G.solution[i] === 1) G.setCell(i, 1);
        G.reportWin();
        lastSolveAt = t;
        lastProgress = t;
        mark(`solve@R${radius}`, t);
        G.startPuzzle(); // the auto-next timer's job, done on the harness clock
      }
    }

    // 2) The crucible is the master gate: upgrade whenever affordable.
    if (radius < G.MAX_RADIUS && gs.resources.prima_materia.amount >= gs.upgrades.board_size.cost) {
      G.upgradeBoard();
      lastProgress = t;
      mark(`radius ${gs.upgrades.board_size.radius}`, t);
    }

    // 3) Inscription: buy back solve time whenever affordable.
    if (gs.resources.prima_materia.amount >= G.inscriptionCost()) {
      G.buyInscription();
      lastProgress = t;
      mark(`inscription ${gs.upgrades.inscription.level}`, t);
    }

    // 4) Generators: expand whenever affordable.
    for (const id of Object.keys(G.GENERATORS)) {
      if (gs.upgrades.board_size.radius < G.GENERATORS[id].minRadius) continue;
      if (gs.resources.prima_materia.amount >= G.generatorCost(id)) {
        G.buyGenerator(id);
        lastProgress = t;
        mark(`gen ${id}`, t);
      }
    }

    // 5) Prep the next tech: follow the recipe chain for the metals it
    //    needs (a player reads "requires 3 copper" and makes copper first).
    const next = G.TECHS.find(tt => !gs.techTree[tt.id] && tt.req.every(r => gs.techTree[r]));
    if (next) {
      for (const [rid, need] of Object.entries(next.cost)) {
        const acted = rid === "quintessence"
          ? prepQuintessence(G, need, mark, t)
          : (G.METAL_RECIPES[rid] ? prepMetal(G, rid, need, mark, t) : false);
        if (acted) lastProgress = t;
      }
      // 6) Buy the tech when ready.
      const ok = Object.entries(next.cost).every(([id, n]) => amountOf(G, id) >= n);
      if (ok) {
        G.buyTech(next.id);
        lastProgress = t;
        mark(next.id, t);
      }
    }

    // 7) Stall detection.
    if (t - lastProgress >= STALL_SECONDS) {
      stall = { at: t, snap: snapshot(G) };
      break;
    }
    if (gs.techTree.philosophers_stone) { mark("stone", t); break; }
  }
  return { seed, milestones, stall, final: snapshot(G), stone: milestones.stone ?? null };
}

const fmt = s => {
  if (s == null) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return m ? `${m}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
};

function report() {
  let failures = 0;
  console.log("== unit checks ==");
  for (const c of checkResults) {
    console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
    if (!c.pass) failures++;
  }

  console.log(`\n== pacing simulation (${RUNS} runs, greedy player, 1 tick = 1 s) ==`);
  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    const r = simulate(1000 + i);
    results.push(r);
    const ms = r.milestones;
    console.log(`run ${i} (seed ${r.seed}): stone ${fmt(r.stone)}`);
    console.log(`  radii: ${[4, 5].map(x => `${x}@${fmt(ms[`radius ${x}`])}`).join("  ")}`);
    const insMarks = Object.keys(ms).filter(k => k.startsWith("inscription ")).sort((a, b) => +a.split(" ")[1] - +b.split(" ")[1]);
    console.log(`  inscription: ${insMarks.length ? insMarks.map(k => `${k.split(" ")[1]}@${fmt(ms[k])}`).join("  ") : "—"}`);
    console.log(`  metals: lead@${fmt(ms["first lead"])}  iron@${fmt(ms["first iron"])}  copper@${fmt(ms["first copper"])}  silver@${fmt(ms["first silver"])}  gold@${fmt(ms["first gold"])}`);
    console.log(`  techs: ${G_Techs.map(id => `${id}@${fmt(ms[id])}`).join("  ")}`);
    if (r.stall) {
      console.log(`  STALL at ${fmt(r.stall.at)}: ${JSON.stringify(r.stall.snap)}`);
    } else if (r.stone == null) {
      console.log(`  HIT SIM CAP, final state: ${JSON.stringify(r.final)}`);
    }
  }

  const stones = results.filter(r => r.stone != null).map(r => r.stone);
  const irons = results.map(r => r.milestones["first iron"] ?? MAX_T);
  const golds = results.map(r => r.milestones["first gold"] ?? MAX_T);
  const stalls = results.filter(r => r.stall).length;
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  console.log("\n== assertions ==");
  const assert = (name, cond, detail = "") => {
    console.log(`  [${cond ? "PASS" : "FAIL"}] ${name}${detail ? `  (${detail})` : ""}`);
    if (!cond) failures++;
  };
  const A_STONE_MAX = 7200;   // finish within 2 h
  const A_IRON_MAX = 600;     // first iron within 10 min
  const A_GOLD_MAX = 5400;    // first gold within 90 min
  const A_STALLS = 0;

  assert("no soft-locks", stalls === A_STALLS, `${stalls}/${RUNS} stalled`);
  assert("stone in every run", stones.length === RUNS, `${stones.length}/${RUNS} finished`);
  if (stones.length) assert(`stone ≤ ${A_STONE_MAX / 60} min`, Math.max(...stones) <= A_STONE_MAX, `max=${fmt(Math.max(...stones))} avg=${fmt(avg(stones))}`);
  assert(`first iron ≤ ${A_IRON_MAX / 60} min`, Math.max(...irons) <= A_IRON_MAX, `max=${fmt(Math.max(...irons))}`);
  assert(`first gold ≤ ${A_GOLD_MAX / 60} min`, Math.max(...golds) <= A_GOLD_MAX, `max=${fmt(Math.max(...golds))}`);
  assert("crucible fully expanded in every run", results.every(r => r.final.radius === 5), `min=${Math.min(...results.map(r => r.final.radius))}`);
  assert("inscription entwined (≥ level 2 by the stone)", results.every(r => r.final.inscription >= 2), `min=${Math.min(...results.map(r => r.final.inscription))}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

// tech ids for reporting
const G_Techs = ["nigredo", "albedo", "citrinitas", "rubedo", "philosophers_stone"];

runUnitChecks();
report();
