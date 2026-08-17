# Surround Seven — Engine Notes (Port Reference)

> Reconstructed examiner-style on 2026-06-23 — every line traced and explained from scratch, no spoonfeeding. **This is the *map*, not a tutorial**: it exists to jog recall and to be the reference when rebuilding the engine in Godot. Line numbers are for `surround-seven.html`.

## Current `index.html` divergence (2026-07-26)

`surround-seven.html` remains the historical single-clue reference described below. The campaign in `index.html` now uses mixed exact-count clue definitions shaped as `{count, kind, axis, cells}`:

- **Surround:** self + immediate neighbours.
- **Halo `○`:** immediate neighbours, excluding self.
- **Spear `╲ — ╱`:** the complete board axis through the clue.
- **Flow `→`:** the fixed ray ahead of the clue, starting at the next cell.
- **Mirror `◇`:** the surrounding cluster reflected through the board centre.

The deduction rules are unchanged: they operate on each definition's `cells` scope instead of always using `block[i]`. Greedy stripping protects one clue of every language unlocked for that metal, so mixed tiers cannot generate without their new mechanic.

In deliberate mode, Mirror-governed cells carry a faint `◇`; it becomes `◆` when a satisfied Mirror proves that unknown cell is waste. A Mirror clue does not fade until every cell in its remote scope has been explicitly classified. Speed mode hides these dependency marks and performs the waste deduction automatically.

## Call chain
```
startTier → generate → buildOne → trySolve → deduce → block / topology
```
Trace a puzzle from "click a tier" down to "two cells get force-flagged green," and back up.

## 1. Topology  (buildTopology 163–175, DIRS 134)
- **Axial / cube hex coordinates.** Cells stored flat in `cells[]`, each `{q, r, idx}`.
- **Hexagon membership:** `-R≤q,r≤R` **and** `|q+r|≤R`. That third condition is really `|s|≤R`, where `s = -(q+r)` is the implicit 3rd cube axis. Three axes each capped at ±R → 6 edges → hexagon. (A square grid would only need the first two — the 3rd condition is the tell it's *not* a staggered/offset grid.)
- **`idxOf`** = `Map "q,r" → flat array index`. The coord→index bridge; bidirectional with each cell's stored `idx`.
- **`DIRS`** = 6 neighbour offsets, counter-clockwise from east. `block[i]` = **self** (pre-seeded line 170) **+ existing neighbours** → **7 interior, fewer on the rim** (off-board neighbour ⇒ `idxOf.get` returns `undefined` ⇒ skipped by the `k!==undefined` guard). The hexagon boundary *is* the bounds check.
- Reference: **Red Blob Games, "Hexagonal Grids"** (redblobgames.com/grids/hexagons).

## 2. Solver — `deduce` (177–195), `trySolve` (196)
- **`known[]` is three-state:** `-1` unknown · `0` empty/red · `1` filled/green.
- Per clued cell: `kf` = known-green count in `block[i]`; `unk` = unknown cells; `need = clue - kf` = greens still required.
- **Two FORCED rules — this is the entire engine:**
  - `need===0` → every `unk` cell is forced **empty** (quota met, no more greens allowed).
  - `need===unk.length` → every `unk` cell is forced **green** (exactly enough slots left).
- `need<0` or `need>unk.length` → **`"contradiction"`** (clue impossible).
- Loops (`while(prog)`) until a full sweep deduces nothing new. `"solved"` = no `-1` left.
- **Forced-only ⇒ no guessing ⇒ that's *why* every puzzle is no-guess.** `deduce` is NOT greedy — it never chooses, it only acts on certainties.

## 3. Generator — `buildOne` (202–217)
- `sol` = random target solution (`density` = P(green) per cell).
- `full` = the clue for *every* cell (greens in its `block`) = the **fully-clued / easiest** version.
- **Early reject (206):** if `deduce` can't solve the fully-clued board, scrap this `sol` and retry. (Removing clues only makes a puzzle *harder*, so if the easiest version fails deduction, no stripped subset can succeed — bail cheap.)
- **Greedy shuffle-strip (208–215):** in random order, null each clue; keep it removed if the board still `deduce`-solves to `sol`, else restore it. Result = a **locally** minimal (not globally minimal) unique no-guess puzzle. `shuffle` makes the greedy removal order-dependent → variety of different minimal puzzles.

## 4. `generate` (221–232)
- Runs `buildOne` **`attempts`** times; `cnt` = count of **surviving (non-null) clues**; keeps the **fewest** = **sparsest = hardest**.
- `attempts` scales difficulty per tier: Lead→Quicksilver `1`, **Silver `4`, Gold `14`**. Sparsity is the difficulty knob, stacked on `radius` + `density`.

## 5. State model & gotchas (port these *consciously*)
- **`TIERS`** config drives `radius / density / attempts / colour` per metal.
- **`completed[]`** = per-tier done flags. Always a **contiguous prefix** `[✓..✓✗..✗]` (can't finish tier *i* without *i-1*) → compressible to a single integer. **Not** derivable from `currentTier` — replay decouples them.
- **`currentTier`** = the board being forged *now* (→ radius). Can move **backward** via ladder replay, so it ≠ "highest tier reached."
- **Line 213** (`known[k]!==sol[k]`) is **redundant** — forced moves ⇒ a `"solved"` board is unique ⇒ it *must* equal `sol`. Belt-and-braces only. `"contradiction"` is likewise unreachable when clues come from a real `sol`, but justified as general-solver hygiene.
- **`setTimeout(generate, 20)`** in `startTier`: JS is single-threaded and that thread also paints, so the timeout *yields* the thread to let "Forging…" paint **before** the blocking `generate` runs. It doesn't cure the freeze — it front-loads the feedback.

## Port notes → Godot
- **Topology + `deduce` port near line-for-line** to GDScript (pure logic, no DOM).
- **Rebuild rendering native** (don't port the SVG/DOM layer).
- **Generator is just-in-time** per the roadmap: *game-feel-first* — bake the existing JS puzzles as **data** first, build the clickable hex grid, and only port `buildOne`/`deduce` when live generation is actually needed.
- **Rebuilding from this map IS the anti-atrophy rep** — if I can reconstruct the engine in Godot from these notes, I own it.

## Economy & progression (2026-08-17)

The campaign in `index.html` wraps the engine above in an incremental
economy. The board is no longer just a puzzle to clear — **it is the
transmutation engine**. This section is the reference for that layer.

### Resources
- **Prima Materia** — the base resource. Gathered two ways:
  - **`BASE_GATHER = 0.5/s`** always (the alchemist's own hands). This
    floor also removes the level-0 soft-lock: a solve can spend your
    entire stash, but base income means you can always recover.
  - **Generators** (`GENERATORS`), bought with prima, unlocked by
    crucible radius: `extractor` (prima, R3), `earth_well` (R4),
    `water_well` (R5), `air_vent` (R6), `fire_furnace` (R7). Rate =
    `baseRate * 1.5^(level-1)`; cost = `floor(baseCost * 1.8^level)`.
- **Elements** — earth / water / air / fire / quintessence. The four
  classical elements come **out of solved puzzles** (below); only
  quintessence is still distilled by hand (10 of each element).
- **Metals** — lead / iron / copper / silver / gold, transmuted in the
  Alembic (`METAL_RECIPES`), each cross-pool (e.g. copper needs iron +
  fire).

### The feed economy (`setCell`)
- Painting a cell **green feeds it 1 prima**. No prima ⇒ the paint is
  refused (`setCell` returns `false`).
- Changing a fed cell back to empty, or **Reset**, **refunds** each fed
  cell 1:1.
- **Reveal** is a free peek: it sets `solved` without feeding and
  grants **nothing**.

### A solve is a transmutation (`reportWin`)
- On a completed pattern, the crucible releases the **elements its
  current radius knows**: `ELEMENTS_BY_RADIUS` — R3 earth; R4 +water;
  R5 +air; R6/R7 +fire.
- Yield per element = `transmuteYield(greens) = max(1, round(greens/10))`,
  so a bigger board (more green cells) releases more. The win banner and
  the `#recipe` line state the feed cost and expected output up front.

### Progression
- **Crucible radius** (`upgrades.board_size`, max `MAX_RADIUS=7`) is the
  master gate: it sizes the board, unlocks locations, clue kinds
  (`CLUE_BY_RADIUS`), elements per solve, and generator slots.
- **Tech tree** (`TECHS`) refines the work: nigredo → albedo →
  citrinitas → rubedo → **philosophers_stone**, each costing metals +
  elements. Forging the Stone raises the **Magnum Opus** gold overlay
  (`celebrateMagnumOpus`) with a *Continue the Work* button into endless
  mode.
- Save slot `greatwork_v3` (bumped when the economy shape changed);
  `loadProgress` merges every pool with defaults.

### Pacing harness (`pacing-test.mjs`)
- Runs the **real** `<script>` headlessly: a minimal DOM stub, a seeded
  `Math.random`, and `tick()` driven by the second (timers are captured,
  never fired, so the sim is deterministic).
- **Unit checks** lock the feed economy (cost, refund, no-feed lockout,
  tick income, per-radius yields, reveal-gives-nothing, reset refunds,
  win feedback, Magnum Opus overlay).
- **Simulation**: a greedy player solves on a per-radius interval,
  upgrades the crucible when affordable, buys generators, follows the
  metal recipe chain for the next tech, and buys techs. It reports a
  milestone timeline, detects stalls (no progress in 10 min), and asserts
  pacing: no soft-locks, stone within 2 h, first iron within 10 m, first
  gold within 90 m. Verified: 5/5 runs finish, stone averages ~90 m.
- **Run:** `bun run pacing-test.mjs [--runs N]`.
