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
      this.textContent = "";
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
      this._innerHTML = String(html);
      this.children = [];
      const re = /<(\w+)[^>]*id="([^"]+)"/g;
      let m;
      while ((m = re.exec(this._innerHTML))) {
        const el = new El(m[1]);
        el.id = m[2];
        byId.set(m[2], el);
        this.children.push(el);
      }
    }
    get innerHTML() { return this._innerHTML; }
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
  setCell, startPuzzle, reportWin, tick, updateUI,
  generatorCost, generatorRate,
  saveProgress, loadProgress,
  upgradeBoard, buyTech, transmute, buyGenerator,
  addInventory, canAfford, spend,
  ELEMENTS_BY_RADIUS, GENERATORS, TECHS, METAL_RECIPES, ELEMENT_RECIPES, MAX_RADIUS, LOCATIONS,
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
  // U11: location UI (id, title, body background) follows board progression.
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
    check("U11b Lunar Sanctum at R5", gs.upgrades.board_size.radius === 5 && assertLoc("lunar_sanctum"));
    G.upgradeBoard(); G.upgradeBoard();
    check("U11c Aetheric Vault at R7", gs.upgrades.board_size.radius === 7 && assertLoc("aetheric_vault"));
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
    gs.resources.prima_materia.amount = 5000;
    a.G.transmute("metal", "lead");   // first metal
    a.G.saveProgress();
    const b = launchGame(14, store);
    const g2 = b.G.gameState;
    check("U13a radius restored", g2.upgrades.board_size.radius === 4);
    check("U13b generator restored", g2.generators.extractor === 1);
    check("U13c metal restored", g2.metals.lead.amount === 1);
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
}

// ---------- Pacing simulation ----------
const SOLVE_TIME = { 3: 90, 4: 110, 5: 130, 6: 150, 7: 170 }; // seconds to solve, per radius
const MAX_T = 7200;          // 120 min sim cap
const STALL_SECONDS = 600;   // no progress for 10 min => soft-lock suspicion

function snapshot(G) {
  const g = G.gameState;
  return {
    radius: g.upgrades.board_size.radius,
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

    // 1) Solve the current puzzle when the player is ready and can afford the feed.
    if (!gs.currentPuzzle.solved && t - lastSolveAt >= SOLVE_TIME[radius]) {
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

    // 3) Generators: expand whenever affordable.
    for (const id of Object.keys(G.GENERATORS)) {
      if (gs.upgrades.board_size.radius < G.GENERATORS[id].minRadius) continue;
      if (gs.resources.prima_materia.amount >= G.generatorCost(id)) {
        G.buyGenerator(id);
        lastProgress = t;
        mark(`gen ${id}`, t);
      }
    }

    // 4) Prep the next tech: follow the recipe chain for the metals it
    //    needs (a player reads "requires 3 copper" and makes copper first).
    const next = G.TECHS.find(tt => !gs.techTree[tt.id] && tt.req.every(r => gs.techTree[r]));
    if (next) {
      for (const [rid, need] of Object.entries(next.cost)) {
        const acted = rid === "quintessence"
          ? prepQuintessence(G, need, mark, t)
          : (G.METAL_RECIPES[rid] ? prepMetal(G, rid, need, mark, t) : false);
        if (acted) lastProgress = t;
      }
      // 5) Buy the tech when ready.
      const ok = Object.entries(next.cost).every(([id, n]) => amountOf(G, id) >= n);
      if (ok) {
        G.buyTech(next.id);
        lastProgress = t;
        mark(next.id, t);
      }
    }

    // 6) Stall detection.
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
    console.log(`  radii: ${[4, 5, 6, 7].map(x => `${x}@${fmt(ms[`radius ${x}`])}`).join("  ")}`);
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

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

// tech ids for reporting
const G_Techs = ["nigredo", "albedo", "citrinitas", "rubedo", "philosophers_stone"];

runUnitChecks();
report();
