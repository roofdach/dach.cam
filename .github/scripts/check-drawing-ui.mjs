import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:3000";
for (let attempt = 0; ; attempt++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    // The production server is still starting.
  }
  if (attempt === 100) throw new Error("server did not start");
  await delay(300);
}

async function post(path, body) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}

async function roomFor(game) {
  const host = await post("/api/" + game + "/rooms", { name: "Host" });
  const code = host.room.code;
  const path = "/api/" + game + "/rooms/" + code;
  const guest = await post(path, { type: "join", name: "Guest" });
  const act = (you, body) => post(path, { player: you.id, token: you.token, ...body });
  const started = await act(host.you, { type: "start" });
  return { code, path, host: host.you, guest: guest.you, act, started };
}

const browser = await chromium.launch({ headless: true });
const failures = [];
async function open(game, room, you, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  await page.addInitScript(({ key, you }) => {
    localStorage.setItem(key, JSON.stringify(you));
    localStorage.setItem("games:name", "Host");
  }, { key: game + ":room:" + room.code, you });
  await page.goto(base + "/" + game + "/" + room.code);
  await page.locator("canvas").first().waitFor();
  return page;
}

const red = [239, 19, 11];
const white = [255, 255, 255];
async function pixel(page, x = 400, y = 300) {
  return page.locator("canvas").first().evaluate((canvas, { x, y }) =>
    Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data).slice(0, 3), { x, y });
}
async function waitPixel(page, rgb, x = 400, y = 300) {
  await page.waitForFunction(({ rgb, x, y }) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return false;
    const data = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
    return rgb.every((value, i) => data[i] === value);
  }, { rgb, x, y });
}
const undo = (page) => page.getByRole("button", { name: "undo (ctrl+z)", exact: true });
const redo = (page) => page.getByRole("button", { name: "redo (ctrl+shift+z)", exact: true });

async function stroke(page, from, to, pause = 0) {
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0);
  const point = ([x, y]) => [box.x + x * box.width / 800, box.y + y * box.height / 600];
  await page.mouse.move(...point(from));
  await page.mouse.down();
  await page.mouse.move(...point([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 5 });
  if (pause) await delay(pause);
  await page.mouse.move(...point(to), { steps: 5 });
  await page.mouse.up();
}

async function exercise(page) {
  assert.ok(await redo(page).isDisabled(), "redo starts disabled");
  await page.getByRole("button", { name: "red", exact: true }).click();
  await page.getByRole("button", { name: "huge brush", exact: true }).click();
  await stroke(page, [150, 300], [650, 300], 500);
  await waitPixel(page, red);
  await page.getByRole("button", { name: "eraser", exact: true }).click();
  await stroke(page, [400, 280], [400, 320]);
  assert.deepEqual(await pixel(page), white);
  assert.deepEqual(await pixel(page, 200), red);
  await undo(page).click();
  assert.deepEqual(await pixel(page), red);
  await page.keyboard.press("Control+Shift+Z");
  assert.deepEqual(await pixel(page), white);
  await page.keyboard.press("Control+Z");
  assert.deepEqual(await pixel(page), red);
  await page.keyboard.press("Control+Y");
  assert.deepEqual(await pixel(page), white);
  await page.getByRole("button", { name: "brush", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "red", exact: true }).getAttribute("aria-pressed"), "true", "eraser remembers brush colour");
  await page.getByRole("button", { name: "clear the board", exact: true }).click();
  assert.deepEqual(await pixel(page, 200), white);
  await undo(page).click();
  assert.deepEqual(await pixel(page, 200), red);
  await redo(page).click();
  assert.deepEqual(await pixel(page, 200), white);
  await undo(page).click();
  // A new stroke invalidates redo without restoring the cleared board.
  await stroke(page, [100, 100], [120, 100]);
  assert.ok(await redo(page).isDisabled());
  await undo(page).click();
  // Undo both the eraser and the multi-batch original line, then redo both.
  await undo(page).click();
  assert.deepEqual(await pixel(page), red);
  await undo(page).click();
  assert.deepEqual(await pixel(page, 200), white);
  await redo(page).click();
  assert.deepEqual(await pixel(page, 200), red);
  await redo(page).click();
  assert.deepEqual(await pixel(page), white);
}

try {
  const draw = await roomFor("draw");
  const turn = draw.started.room.game.turn.id;
  await draw.act(draw.host, { type: "choose", turn, i: 0 });
  const drawer = await open("draw", draw, draw.host);
  const watcher = await open("draw", draw, draw.guest);
  await drawer.waitForFunction(() => !document.querySelector('[aria-label="red"]').disabled);
  await exercise(drawer);
  await waitPixel(watcher, red, 200);
  await waitPixel(watcher, white);
  const downloadEvent = drawer.waitForEvent("download");
  await drawer.getByRole("button", { name: "save drawing", exact: true }).click();
  const download = await downloadEvent;
  const image = (await readFile(await download.path())).toString("base64");
  const exported = await drawer.evaluate(async (image) => {
    const img = new Image();
    img.src = "data:image/png;base64," + image;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const at = (x) => Array.from(ctx.getImageData(x, 300, 1, 1).data).slice(0, 3);
    return { width: img.width, height: img.height, centre: at(400), left: at(200) };
  }, image);
  assert.deepEqual(exported, { width: 800, height: 600, centre: white, left: red });
  await drawer.reload();
  await waitPixel(drawer, red, 200);
  assert.deepEqual(await pixel(drawer), white);
  assert.ok(await redo(drawer).isDisabled(), "reload resets the local redo stack");
  console.log("PASS draw: tools, shortcuts, complete strokes, replay, export and reload");

  const phone = await roomFor("phone");
  const game = phone.started.room.game.index;
  await phone.act(phone.host, { type: "submit", game, step: 0, text: "a red bridge" });
  await phone.act(phone.guest, { type: "submit", game, step: 0, text: "a red tunnel" });
  const mobile = await open("phone", phone, phone.host, { viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true });
  const targets = await mobile.getByRole("group", { name: "colour", exact: true }).getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => { const r = button.getBoundingClientRect(); return [r.width, r.height]; }));
  assert.equal(targets.length, 24);
  assert.ok(targets.every(([w, h]) => w >= 44 && h >= 44), "all touch colours have 44-pixel targets");
  for (const name of ["eraser", "huge brush", "undo (ctrl+z)", "redo (ctrl+shift+z)"]) {
    const box = await mobile.getByRole("button", { name, exact: true }).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, name + " has a touch target");
  }
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "320px layout has no horizontal overflow");
  await exercise(mobile);
  await mobile.reload();
  await waitPixel(mobile, red, 200);
  assert.deepEqual(await pixel(mobile), white);
  assert.ok(await redo(mobile).isDisabled());
  await mobile.getByRole("button", { name: "done", exact: true }).click();
  await phone.act(phone.guest, { type: "submit", game, step: 1, ops: [["l", 0, 7, 1, 50, 50, 100, 100]] });
  const response = await fetch(base + phone.path + "?chain=" + game + ".1");
  const result = await response.json();
  assert.ok(response.ok && result.chain, JSON.stringify(result));
  const submitted = result.chain.entries.find((entry) => "ops" in entry);
  assert.ok(submitted.ops.some((op) => op[0] === "l" && op[2] === 0), "the redone eraser survives hand-in");
  assert.ok(submitted.ops.some((op) => op[0] === "l" && op[2] === 2), "the redone brush survives hand-in");
  assert.ok(submitted.ops.every((op) => op[0] !== "u"), "phone compacts the append-only history");
  assert.deepEqual(failures, [], "no browser runtime errors");
  console.log("PASS phone: shared tools, touch controls, draft reload and submission");
} finally {
  await browser.close();
}
