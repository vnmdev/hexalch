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

Flow and spear clues carry a **live badge** next to the glyph: `remaining = count − greens painted` (painted + badge = the count, so a player can always see exactly how many more greens the scope needs). Gold when `remaining` equals the **live unknowns** in scope — those cells are then dashed-outlined as **forced moves** (the next valid move); green ✓ when satisfied; red ! when overfilled. A *live unknown* is an uncolored cell that is not yet proven non-green: in fast mode the auto-faded cells (satisfied clues' leftover scopes) still hold state 0, so `updateFades` runs two passes — pass 1 computes the proven-red set, pass 2 counts live unknowns as `state 0 AND NOT proven-red`. Without the split, a line/arrow clue with one tile left was never highlighted mid-deduction in fast mode, because the faded-but-uncolored cells were counted as unknowns.

**Glyph icons** come from the provided sprite pack `assets/sprites/hex-alchemist-icons_4/` — the **`affinity/` coloured set** (the README reserves it for the metals + Stone tiers, which monochrome tinting cannot reproduce; `source/` is the currentColor web set, `godot/` white-for-tinting). The 16 used glyphs are inlined in `ICON_SVGS` so the game stays a single file. The six gradient glyphs (lead, iron, copper, silver, gold, philosophers-stone-iv) carry `id="g"` in the originals — inlining many copies into one document would make every `url(#g)` resolve to the FIRST gradient on the page, so ids are **namespaced per icon** (`g-<name>` + matching `url(#g-<name>)`). `ICON_GLOW` holds each glyph's glow colour; `.icon` applies `filter: drop-shadow(0 0 3px var(--glow))` — the web stand-in for the pack's pre-rasterised halo PNGs (7–10 KB each, not inlined). `iconHtml(id, size, label)` renders one with a native `title` tooltip. Mapping: prima materia→alkahest, the five elements→themselves, the five metals→themselves, nigredo→black-mercury, albedo→salt, citrinitas→sulfur, rubedo→philosophers-sulfur, Philosopher's Stone→philosophers-stone-iv (also the Magnum Opus banner icon, set in `celebrateMagnumOpus`, with a 16 px glow in the stone's own orange). Icons appear on ledger rows, transmutation rows, tech-tree rows, generator rows, the recipe line, the win-banner output, and the opus banner.

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
    `water_well` (R4), `air_vent` (R5), `fire_furnace` (R5). Rate =
    `baseRate * 1.5^(level-1)`; cost = `floor(baseCost * 1.8^level)`.
  - The **ledger** (left panel) shows each resource's passive income
    next to its count (`+X.X/s`) so accumulation is visible while
    solving; `incomeRate(id)` sums base gathering (prima) and every
    generator that produces the resource.
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
  R5 all four classical elements.
- Yield per element = `solveYield(greens) =
  transmuteYield(greens) + floor(inscription level / 2)` where
  `transmuteYield = max(1, round(greens/10))`. The crucible caps at
  radius five (36-ish green cells ⇒ ~4 per element), so **inscription
  deepens the transmutation** to keep late-game output growing: every
  two etched levels add one of each element per solve. The win banner
  and the `#recipe` line state the feed cost and expected output up
  front (including the etching bonus).

### Progression
- **Crucible radius** (`upgrades.board_size`) grows **at most twice**
  (R3 → R4 → R5, costs 50 → 80) and then reaches its final form.
  Radius sizes the board, unlocks clue forms (surround / halo / spear),
  elements per solve, generator slots, and the first three locations.
- **Clue inscription** (`upgrades.inscription`, cost
  `floor(100 * 1.6^level)`) is the long upgrade path and the entanglement
  between the incremental and puzzle halves — it buys back solve time:
  - each level re-etches **3 stripped clues** onto the current board
    (`currentPuzzle.removedFull` remembers the generator's removal
    order; `inscribed` how many were restored) and **pre-inscribes all
    future boards** by `level * 3`;
  - level **3** unlocks **flow**, level **6** unlocks **mirror** clue
    forms on future boards (`clueKinds(radius, level)`);
  - every two levels deepen the transmutation yield (above).
  Adding clues back never breaks unique solvability, so inscription can
  only make a board easier — the late game gets faster and richer
  instead of merely bigger.
- **Locations**: leaden chamber (R3), martial forge (R4), lunar sanctum
  (R5), solar temple (R5 + inscription 3), aetheric vault (R5 +
  inscription 6). `checkAndSetLocation` applies both gates.
- **Tech tree** (`TECHS`) refines the work: nigredo → albedo →
  citrinitas → rubedo → **philosophers_stone**, each costing metals +
  elements. Forging the Stone raises the **Magnum Opus** gold overlay
  (`celebrateMagnumOpus`) with a *Continue the Work* button into endless
  mode.
- **Upgrade UI**: the Alembic's upgrades section shows **every option
  at once** — crucible expansion, inscription, and all five generator
  rows (locked rows visible with their unlock radius) — plus a
  status footer (current clue forms, next location).
- **Real-time affordability, without DOM churn**: the 1 s loop calls
  `updateDynamicUI()`, which updates the registered ledger amount spans
  and buy buttons **in place** (the lists are not rebuilt, so hover/focus
  survive and the inline glyph SVGs are not discarded every second). A
  full `updateUI()` rebuild runs only on structural changes (buy,
  transmute, new puzzle, inscription, radius). Buttons flip enabled the
  second passive income crosses a cost (U18, U23).
- **Clue guide** (`#clue-guide`, in the Crucible): lists the clue
  languages currently in play — one row per unlocked form with its glyph
  and plain meaning (wording shared with the board tooltips). A row
  appears exactly when the form can appear (surround at R3, halo at R4,
  spear at R5, flow at inscription 3, mirror at inscription 6), so the
  player learns each language the moment it matters (U24).
- **Affordance flash**: when a buy button flips unaffordable→affordable
  between two ticks, `updateDynamicUI()` adds the `just-affordable` class
  (one-shot gold box-shadow pulse; removed when it goes unaffordable
  again). Affordable buy buttons carry a quiet accent border so the eye
  can find what it can buy (U25).
- **Forced-move march**: a `forced` outline cell animates — its dashed
  stroke marches (`forcedMarch`) and thickens (`forcedPulse`) — so the
  one tile you must paint visibly pulses (CSS only; no JS per-frame).
- **Works counter** (`gameState.works`, in the Crucible): counts
  completed puzzles, increments in `reportWin`, rendered by
  `renderWorks()` on structural updates, and persisted through the
  save/load round trip (U13f, U25e/f).
- **Clue-progress chip** (`#clue-progress`, under the board): a live
  `satisfied/total` count of the clue rows, updated in `updateFades()`
  on every paint so the solver can see how close the board is (U26).
- **Goal hint + move count**: a fresh board sets the status line to the
  goal ("match every clue's number, then Check") so a first-time player
  is never left without instructions; `setCell()` counts real state
  changes into `puzzleMoves` (reset per puzzle, same-value repaints
  are skipped), and the win banner reports it — "… prima fed · N moves"
  (U27).
- Save slot `greatwork_v4` (bumped when the economy shape changed);
  `loadProgress` merges every pool with defaults and starts a fresh
  puzzle at the saved radius + inscription level.

### Pacing harness (`pacing-test.mjs`)
- Runs the **real** `<script>` headlessly: a minimal DOM stub, a seeded
  `Math.random`, and `tick()` driven by the second (timers are captured,
  never fired, so the sim is deterministic). The stub's innerHTML setter
  parses `id` **and** the `disabled` attribute, so button state can be
  asserted.
- **Unit checks** lock the feed economy (cost, refund, no-feed lockout,
  tick income, per-radius yields incl. all-four-at-R5,
  reveal-gives-nothing, reset refunds, win feedback, Magnum Opus
  overlay), fast mode, location ladder incl. inscription gates, mouse
  painting, save/load (incl. inscription + pre-inscribed restart),
  Check, manual mode, **unified upgrades list** (U16), **inscription
  mechanics** — clue etching, pre-inscription, flow/mirror unlocks,
  deducibility (U17) — **real-time button flips** (U18), and **flow/
  spear badges** — remaining count, paint tracking, forced-move outline
  line/arrow clues (U21) — and **coloured glyphs**: real colours, no
  currentColor, per-icon gradient ids, url(#) refs resolving locally (U22),
  **in-place refresh** (amounts/buttons update without a rebuild; node
  identity preserved across a tick, U23), the **clue guide** tracking
  unlocked forms (U24), the **affordance flash** + **works counter**
  (U25, and works restored on load, U13f), the **clue-progress chip**
  reading `0/N` fresh and `N/N` solved (U26), and the **goal hint +
  move count** on the win banner (U27). The DOM stub's `textContent`
  is DOM-faithful: an `innerHTML` set makes `textContent` return the
  tag-stripped text (the win banner renders output icons via `innerHTML`).
- **Simulation**: a greedy player solves on a per-radius interval that
  **shrinks with inscription** (`base * 0.95^etched clues`, floor 30 s),
  upgrades the crucible, **buys inscription whenever affordable**, buys
  generators, follows the metal recipe chain for the next tech, and
  buys techs. It reports a milestone timeline (incl. inscription
  levels), detects stalls (no progress in 10 min), and asserts: no
  soft-locks, stone within 2 h, first iron within 10 m, first gold
  within 90 m, crucible fully expanded, inscription ≥ level 2 by the
  stone (the entanglement actually fires). Verified: 10/10 runs finish,
  stone max 82 m, averages ~81 m 35 s.
- **Run:** `bun run pacing-test.mjs [--runs N]`.
