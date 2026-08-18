import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const profile = await mkdtemp(join(tmpdir(), "hexalch-chromium-"));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(error => error ? reject(error) : resolve(port));
  });
});
const pageUrl = pathToFileURL(join(process.cwd(), "index.html")).href;
const chromium = spawn("chromium", [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  pageUrl
], { stdio: ["ignore", "ignore", "pipe"] });

let chromiumErrors = "";
chromium.stderr.on("data", chunk => { chromiumErrors += chunk; });

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function pageTarget() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(target => target.type === "page" && target.url === pageUrl);
      if (page) return page;
    } catch {}
    await sleep(50);
  }
  throw new Error(`Chromium did not expose the game page.\n${chromiumErrors}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let socket;
try {
  const target = await pageTarget();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.text);
    }
  });

  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await command("Runtime.enable");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`document.querySelectorAll("#board polygon").length > 0`)) break;
    await sleep(50);
  }

  const initial = await evaluate(`({
    ready: document.readyState,
    polygons: document.querySelectorAll("#board polygon").length,
    location: document.getElementById("loc-title").textContent,
    speedMode: gameState.settings.speedMode,
    speedChecked: document.getElementById("speed-mode").checked,
    redDisabled: document.getElementById("tRed").disabled,
    guideLines: document.querySelectorAll("#clue-guide .clue-line").length
  })`);
  assert(initial.ready === "complete", "page did not finish loading");
  assert(initial.polygons === 37, `radius-three board should have 37 cells, got ${initial.polygons}`);
  assert(initial.location === "The Leaden Chamber", `unexpected initial location: ${initial.location}`);
  assert(initial.speedMode && initial.speedChecked && initial.redDisabled, "Fast Mode is not the synchronized default");
  assert(initial.guideLines === 1, `fresh game guide should list one clue form, got ${initial.guideLines}`);

  const icons = await evaluate(`({
    ledger: document.querySelectorAll("#resource-list .icon svg").length,
    tech: document.querySelectorAll("#tech-tree-list .icon svg").length,
    transmute: document.querySelectorAll("#transmute-list .icon svg").length,
    recipe: document.querySelectorAll("#recipe .icon svg").length,
    colored: (() => {
      const svgs = [...document.querySelectorAll(".icon svg")];
      const hasColour = svg => /#[0-9a-f]{6}/i.test(svg.innerHTML) || svg.innerHTML.indexOf("url(#") !== -1;
      const noCurrentColor = svgs.every(svg => svg.innerHTML.indexOf("currentColor") === -1);
      // Gradient refs must resolve inside their own svg (ids are namespaced).
      const local = svgs.every(svg =>
        [...svg.querySelectorAll("[stroke]")].map(e => e.getAttribute("stroke"))
          .filter(v => v && v.indexOf("url(") === 0).every(v =>
            svg.querySelector('linearGradient[id="' + v.slice(5, -1) + '"]') !== null));
      return svgs.length > 0 && svgs.every(hasColour) && noCurrentColor && local;
    })()
  })`);
  assert(icons.ledger >= 1, "ledger rows should carry glyph icons");
  assert(icons.tech === 5, `tech tree should show five icons, got ${icons.tech}`);
  assert(icons.transmute === 6, `transmutation list should show six icons, got ${icons.transmute}`);
  assert(icons.recipe >= 1, "recipe line should render element icons");
  assert(icons.colored, "glyph icons should be coloured, not currentColor, with local gradient refs");

  const solved = await evaluate(`(() => {
    gameState.resources.prima_materia.amount = 20;
    const greens = solution.filter(v => v === 1).length;
    for (let i = 0; i < cells.length; i++) if (solution[i] === 1) setCell(i, 1);
    document.getElementById("check-board").click();
    return {
      solved: gameState.currentPuzzle.solved,
      prima: gameState.resources.prima_materia.amount,
      earth: gameState.elements.earth.amount,
      greens,
      banner: document.getElementById("win-banner").classList.contains("show"),
      status: document.getElementById("status").className
    };
  })()`);
  assert(solved.solved, "a correct board was not accepted");
  assert(solved.prima === 20 - solved.greens, `prima feed cost not applied: ${solved.prima}`);
  assert(solved.earth === Math.max(1, Math.round(solved.greens / 10)), `element yield wrong: ${solved.earth}`);
  assert(solved.banner, "win banner not shown");
  assert(solved.status === "status-win", `win status class is wrong: ${solved.status}`);

  const upgraded = await evaluate(`(() => {
    gameState.resources.prima_materia.amount = 50;
    updateUI();
    document.getElementById("btn-upgrade-board").click();
    return {
      radius: gameState.currentPuzzle.radius,
      location: gameState.currentLocationId,
      clueKinds: [...new Set(clues.filter(Boolean).map(clue => clue.kind))]
    };
  })()`);
  assert(upgraded.radius === 4, `board did not upgrade to radius four: ${upgraded.radius}`);
  assert(upgraded.location === "martial_forge", `location did not follow board progression: ${upgraded.location}`);
  assert(upgraded.clueKinds.includes("surround") && upgraded.clueKinds.includes("halo"), "radius four did not unlock halo clues");

  const transmuted = await evaluate(`(() => {
    gameState.resources.prima_materia.amount = 100;
    gameState.elements.earth.amount = 3;
    updateUI();
    document.getElementById("transmute-m-iron").click();
    return {
      iron: gameState.metals.iron.amount,
      prima: gameState.resources.prima_materia.amount,
      earth: gameState.elements.earth.amount
    };
  })()`);
  assert(transmuted.iron === 1 && transmuted.prima === 0 && transmuted.earth === 0, "cross-pool metal transmutation failed");

  const finalBoard = await evaluate(`(() => {
    while (gameState.upgrades.board_size.radius < MAX_RADIUS) {
      gameState.resources.prima_materia.amount = 100000;
      updateUI();
      document.getElementById("btn-upgrade-board").click();
    }
    for (let i = 0; i < 6; i++) {
      gameState.resources.prima_materia.amount = 100000;
      updateUI();
      document.getElementById("btn-inscribe").click();
    }
    document.getElementById("new-board").click(); // future boards use the etched forms
    return {
      radius: gameState.currentPuzzle.radius,
      inscription: gameState.upgrades.inscription.level,
      location: gameState.currentLocationId,
      clueKinds: [...new Set(clues.filter(Boolean).map(clue => clue.kind))],
      guideLines: document.querySelectorAll("#clue-guide .clue-line").length,
      hasUpgradeButton: Boolean(document.getElementById("btn-upgrade-board")),
      hasInscribeButton: Boolean(document.getElementById("btn-inscribe")),
    };
  })()`);
  assert(finalBoard.radius === 5, `final board radius is wrong: ${finalBoard.radius}`);
  assert(finalBoard.inscription === 6, `inscription did not reach level six: ${finalBoard.inscription}`);
  assert(finalBoard.location === "aetheric_vault", `final location did not unlock: ${finalBoard.location}`);
  assert(finalBoard.clueKinds.length === 5, `final board should use all five clue types: ${finalBoard.clueKinds.join(", ")}`);
  assert(finalBoard.guideLines === 5, `final game guide should list all five clue forms, got ${finalBoard.guideLines}`);
  assert(!finalBoard.hasUpgradeButton, "board upgrade remains available past the cap");
  assert(finalBoard.hasInscribeButton, "inscription should remain available at the cap");
  assert(finalBoard.elements.join(",") === "earth,water,air,fire,quintessence", "classical element roster is wrong");

  const stone = await evaluate(`(() => {
    for (const pool of [gameState.resources, gameState.metals, gameState.elements]) {
      for (const entry of Object.values(pool)) entry.amount = 10000;
    }
    updateUI();
    const ok = TECHS.every(tech => gameState.techTree[tech.id]);
    return { ok, opusIcon: document.querySelector("#opus-icon svg") !== null };
  })()`);
  assert(stone.ok, "the Philosopher's Stone progression could not be completed");
  assert(stone.opusIcon, "Magnum Opus banner should show the stone icon");
  assert(exceptions.length === 0, `browser exceptions: ${exceptions.join("; ")}`);

  console.log("browser smoke test: OK");
} finally {
  socket?.close();
  chromium.kill("SIGTERM");
  await new Promise(resolve => chromium.once("exit", resolve));
  await rm(profile, { recursive: true, force: true });
}
