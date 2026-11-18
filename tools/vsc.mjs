// Drive VS Code for the Web (npx @vscode/test-web on :3000) in a headless Chromium over CDP,
// for trying the extension by hand from a shell.
//   node tools/vsc.mjs start            launch Chromium (CHROME=...) and open VS Code
//   node tools/vsc.mjs cmd "<command>"  run a command from the palette
//   node tools/vsc.mjs type "<text>"    type text + Enter (into whatever has focus)
//   node tools/vsc.mjs key Enter|Escape|Down
//   node tools/vsc.mjs click x,y
//   node tools/vsc.mjs shot <file.png>
//   node tools/vsc.mjs eval "<js>"
import { spawn } from "child_process";
import fs from "fs";
const port = 9351;
const [what, arg] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (what === "start") {
  const c = spawn(process.env.CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, "--user-data-dir=/tmp/chrome-vsc",
    "--window-size=1600,1000", "--autoplay-policy=no-user-gesture-required", "--no-first-run",
    process.env.VSC_URL || "http://localhost:3000/"], { stdio: "ignore", detached: true });
  c.unref();
  console.log("started");
  process.exit(0);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes(process.env.VSC_MATCH || "localhost:3000"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const KEYS = { Enter: ["Enter", 13, "\r"], Escape: ["Escape", 27], F1: ["F1", 112], Down: ["ArrowDown", 40], Tab: ["Tab", 9] };
const key = async (name) => {
  const [k, vk, text] = KEYS[name];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: vk, text });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: vk });
};

if (what === "cmd") {
  await key("F1"); await sleep(700);
  await send("Input.insertText", { text: arg }); await sleep(900);
  await key("Enter");
  console.log("ran", arg);
} else if (what === "type") {
  await send("Input.insertText", { text: arg }); await sleep(300);
  await key("Enter");
  console.log("typed", arg);
} else if (what === "key") {
  await key(arg);
  console.log("pressed", arg);
} else if (what === "click") {
  const [x, y] = arg.split(",").map(Number);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  console.log("clicked", arg);
} else if (what === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(arg || "/tmp/vsc.png", Buffer.from(r.result.data, "base64"));
  console.log("saved", arg || "/tmp/vsc.png");
} else if (what === "eval") {
  const r = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result));
}
process.exit(0);
