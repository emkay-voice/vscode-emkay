// Emkay Dev – write an OpenVoiceOS skill and talk to it at once.
//
// Emkay (OpenVoiceOS in the browser, https://app.emkay.ai) runs in a panel
// next to your code, opened with ?dev. This extension sends it your skill as
// files (Emkay loads it the way ovos-core loads a skill from a folder), the
// sentences you type, and your golden utterances to test; Emkay sends back
// its log, its bus and the verdicts. See web/dev.js in emkay-voice/emkay for
// Emkay's side.
//
// Plain JavaScript and the VS Code API (plus vendor/qrcode.js for the QR
// code, MIT), no npm dependencies, so the same
// file runs in VS Code on a PC (Node) and in the browser (vscode.dev,
// github.dev; a web worker).
const vscode = require("vscode");
const template = require("./template.js");
const qrcode = require("./vendor/qrcode.js");   // qrcode-generator 1.4.4 (MIT, Kazuhiko Arase)

const t = (msg, ...args) => vscode.l10n.t(msg, ...args);

/** @type {vscode.OutputChannel} */ let out;
/** @type {vscode.OutputChannel} */ let busOut;
/** @type {Panel | null} */ let panel = null;
/** @type {vscode.StatusBarItem} */ let status;
/** @type {vscode.TestController} */ let tests;
let lastRun = null;   // {skillId, ok} of the last load
let toldTests = false;   // the "your tests are in the Testing view" note, once a session

// ------------------------------------------------------------------ helpers

function emkayUrl() {
  const base = vscode.workspace.getConfiguration("emkay").get("url") || "https://app.emkay.ai/";
  const u = new URL(base);
  u.searchParams.set("dev", "");
  return u.toString().replace("dev=", "dev");
}

/** bytes -> base64, in pieces (String.fromCharCode takes a limited number of arguments). */
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function readText(uri) {
  try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { return null; }
}

async function exists(uri) {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

// ------------------------------------------------------------ the skill

/**
 * @typedef {object} Skill
 * @property {vscode.Uri} root      the repository (workspace folder)
 * @property {vscode.Uri} folder    the package folder: __init__.py, locale/, ...
 * @property {string} skillId       "ovos-skill-hello.yourname"
 * @property {string[]} requirements
 */

/**
 * Find the skill in the workspace: the opm.skill entry point in
 * pyproject.toml (or setup.py) names its id and package, as for ovos-core.
 * Without one, the first __init__.py with an OVOSSkill in it.
 * @returns {Promise<Skill | null>}
 */
async function findSkill() {
  for (const ws of vscode.workspace.workspaceFolders || []) {
    const root = ws.uri;
    let skillId = null, pkg = null, requirements = [];
    const pyproject = await readText(vscode.Uri.joinPath(root, "pyproject.toml"));
    if (pyproject) {
      const ep = pyproject.match(/\[project\.entry-points\.["']?opm\.skill["']?\]\s*\n\s*["']?([^"'=\s]+)["']?\s*=\s*["']([^"':]+)(?::[^"']*)?["']/);
      if (ep) { skillId = ep[1]; pkg = ep[2]; }
      const deps = pyproject.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m);
      if (deps) requirements = [...deps[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    }
    if (!skillId) {
      const setup = await readText(vscode.Uri.joinPath(root, "setup.py"));
      const ep = setup && setup.match(/["']([A-Za-z0-9._-]+\.[A-Za-z0-9_-]+)\s*=\s*([A-Za-z0-9_.]+)\s*:/);
      if (ep) { skillId = ep[1]; pkg = ep[2]; }
      // OVOS' setup.py template builds the entry point from its URL:
      // "<repo>.<owner>" = <repo with _>:<class>, the package being the repo root
      const url = !ep && setup && setup.match(/URL\s*=\s*["']https:\/\/github\.com\/([^/"']+)\/([^/"']+?)(?:\.git)?["']/);
      if (url) skillId = `${url[2].toLowerCase()}.${url[1].toLowerCase()}`;
    }
    const reqs = await readText(vscode.Uri.joinPath(root, "requirements.txt"));
    if (reqs) requirements.push(...reqs.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("-")));
    let folder = pkg ? vscode.Uri.joinPath(root, ...pkg.split(".")) : null;
    if (folder && !(await exists(vscode.Uri.joinPath(folder, "__init__.py")))) {
      folder = (await exists(vscode.Uri.joinPath(root, "__init__.py"))) ? root : null;
    }
    if (!folder) {
      const inits = await vscode.workspace.findFiles(new vscode.RelativePattern(ws, "**/__init__.py"), "**/{node_modules,.venv,venv,build,dist,tests,test}/**", 50);
      for (const f of inits) {
        if (/OVOSSkill|MycroftSkill/.test((await readText(f)) || "")) { folder = vscode.Uri.joinPath(f, ".."); break; }
      }
    }
    if (!folder) continue;
    if (!skillId) {
      const name = folder.path.split("/").pop().replace(/_/g, "-");
      skillId = `${name}.dev`;
    }
    return { root, folder, skillId, requirements: [...new Set(requirements)] };
  }
  return null;
}

const SKIP_AT_ROOT = new Set(["test", "tests", "docs", "build", "dist", "node_modules", "venv", ".venv"]);

/** The skill's package folder as {relative path: base64}, as Emkay wants it. */
async function filesOf(folder) {
  const files = {};
  let total = 0;
  async function walk(dir, rel) {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
      if (name === "__pycache__" || name.startsWith(".") || name.endsWith(".egg-info")) continue;
      // a skill whose package is the repository itself (the older layout):
      // its tests, docs and build output are not part of the skill
      if (!rel && type & vscode.FileType.Directory && SKIP_AT_ROOT.has(name)) continue;
      const uri = vscode.Uri.joinPath(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      if (type & vscode.FileType.Directory) await walk(uri, path);
      else if (type & vscode.FileType.File) {
        const bytes = await vscode.workspace.fs.readFile(uri);
        total += bytes.length;
        if (total > 20e6) throw new Error(t("The skill folder is over 20 MB; leave big files (models, sounds) out of it."));
        files[path] = base64(bytes);
      }
    }
  }
  await walk(folder, "");
  return files;
}

/** "(hello|hi) from my [first] skill" -> "hello from my first skill": the first of each (a|b), [x] kept. */
function firstOption(line) {
  let s = line, prev;
  do { prev = s; s = s.replace(/\(([^()|]*)(\|[^()]*)?\)/g, "$1"); } while (s !== prev);
  return s.replace(/\[([^\[\]]*)\]/g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * A new skill starts in English (what the rest of OpenVoiceOS reads) and in
 * the user's own language only; Emkay: Add language adds the others. A
 * template without en-US is left as it is.
 * @param {Record<string, Uint8Array>} files  path -> bytes
 * @param {string} lang  Emkay's language, else VS Code's ("da", "pt-br", "en")
 */
function keepLanguages(files, lang) {
  const tags = new Set();
  for (const p of Object.keys(files)) {
    const m = p.match(/(?:^|\/)locale\/([^/]+)\//);
    if (m) tags.add(m[1]);
  }
  const en = [...tags].find((x) => x.toLowerCase() === "en-us");
  if (!en) return files;
  const want = String(lang || "en").toLowerCase();
  const mine = [...tags].find((x) => x.toLowerCase() === want) ||
    [...tags].find((x) => x.toLowerCase().split("-")[0] === want.split("-")[0]);
  const keep = new Set([en.toLowerCase(), (mine || en).toLowerCase()]);
  const out = {};
  for (const [p, bytes] of Object.entries(files)) {
    const loc = p.match(/(?:^|\/)locale\/([^/]+)\//);
    if (loc && !keep.has(loc[1].toLowerCase())) continue;
    const gold = p.match(/golden_utterances_([^/]+)\.jsonl$/);
    if (gold && !keep.has(gold[1].toLowerCase())) continue;
    out[p] = bytes;
  }
  return out;
}

/**
 * A few sentences the skill answers in Emkay's language: the first line of
 * each locale/<lang>/*.intent, with padatious' (a|b) reduced to a.
 * @returns {Promise<string[] | null>} null when the skill has no folder for that language
 */
async function exampleSentences(folder, lang) {
  const locale = vscode.Uri.joinPath(folder, "locale");
  let dirs = [];
  try { dirs = (await vscode.workspace.fs.readDirectory(locale)).filter(([, ty]) => ty & vscode.FileType.Directory).map(([n]) => n); } catch { return null; }
  const want = lang.toLowerCase(), base = want.split("-")[0];
  const dir = dirs.find((d) => d.toLowerCase() === want) || dirs.find((d) => d.toLowerCase().split("-")[0] === base);
  if (!dir) return null;
  const out = [];
  for (const [name] of await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(locale, dir))) {
    if (!name.endsWith(".intent")) continue;
    const text = (await readText(vscode.Uri.joinPath(locale, dir, name))) || "";
    const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
    if (line) out.push(firstOption(line));
  }
  return out.slice(0, 3);
}

/** The skill's golden utterances: test/end2end/golden_utterances_<lang>.jsonl. */
async function goldenRows(skill) {
  const dir = vscode.Uri.joinPath(skill.root, "test", "end2end");
  const rows = [];
  let entries = [];
  try { entries = await vscode.workspace.fs.readDirectory(dir); } catch { return rows; }
  for (const [name] of entries) {
    const m = name.match(/^golden_utterances_(.+)\.jsonl$/);
    if (!m) continue;
    const text = (await readText(vscode.Uri.joinPath(dir, name))) || "";
    text.split(/\r?\n/).forEach((line, i) => {
      line = line.trim();
      if (!line || line.startsWith("#")) return;
      try {
        const row = JSON.parse(line);
        if (row.needs_manual) return;
        row.lang = row.lang || m[1];
        row.skill_id = row.skill_id || skill.skillId;
        rows.push({ row, file: vscode.Uri.joinPath(dir, name), line: i });
      } catch {}
    });
  }
  return rows;
}

// ------------------------------------------------------------ the panel

/** Emkay in a webview panel: a frame with Emkay (?dev) and a line to type in. */
class Panel {
  constructor(context) {
    this.ready = false;
    this.version = "";
    this.nextId = 1;
    this.waiting = new Map();
    this.readyWaiters = [];
    this.view = vscode.window.createWebviewPanel("emkay", "Emkay", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,   // Emkay keeps running while the panel is hidden
    });
    this.view.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
    this.view.webview.html = this.html();
    this.view.onDidDispose(() => {
      panel = null;
      for (const w of this.waiting.values()) w.reject(new Error(t("Emkay was closed")));
      setStatus();
    });
    this.view.webview.onDidReceiveMessage((m) => this.onMessage(m));
  }

  html() {
    const url = emkayUrl();
    const origin = new URL(url).origin;
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const L = {
      placeholder: t("Type what you would say, and press Enter"),
      starting: t("Emkay is starting – the first time takes a few minutes (it downloads OpenVoiceOS into this browser). Tap Start when it shows."),
      send: t("Send"),
    };
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { height: 100%; margin: 0; padding: 0; background: #000; color: #ddd; font: 13px system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  iframe { flex: 1; border: 0; width: 100%; background: #000; }
  form { display: flex; gap: 6px; padding: 8px; background: var(--vscode-sideBar-background, #181818); }
  input { flex: 1; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--vscode-input-border, #444);
    background: var(--vscode-input-background, #222); color: var(--vscode-input-foreground, #eee); font: inherit; }
  button { padding: 7px 14px; border: 0; border-radius: 6px; background: #22a7f0; color: #001018; font-weight: 600; cursor: pointer; }
  #note { padding: 4px 10px 8px; color: #8aa; font-size: 12px; background: var(--vscode-sideBar-background, #181818); }
</style></head><body>
<iframe id="emkay" src="${url}" allow="autoplay; microphone; fullscreen; screen-wake-lock"></iframe>
<form id="f"><input id="q" placeholder="${L.placeholder}" autocomplete="off"><button>${L.send}</button></form>
<div id="note">${L.starting}</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById("emkay");
  const ORIGIN = ${JSON.stringify(origin)};
  let ready = false;
  // Emkay cannot write first: it learns our origin from our first message
  const hello = setInterval(() => frame.contentWindow.postMessage({ emkayDev: 1, op: "hello" }, ORIGIN), 1000);
  addEventListener("message", (e) => {
    if (e.origin === ORIGIN && e.data && e.data.emkayDev === 1) {
      if (e.data.op === "hello" && e.data.ready && !ready) {
        ready = true; clearInterval(hello); document.getElementById("note").hidden = true;
      }
      vscode.postMessage(e.data);
    } else if (e.data && e.data.hint) {
      document.getElementById("q").placeholder = e.data.hint;
    } else if (e.data && e.data.toEmkay) {
      frame.contentWindow.postMessage({ emkayDev: 1, ...e.data.toEmkay }, ORIGIN);
    }
  });
  document.getElementById("f").onsubmit = (e) => {
    e.preventDefault();
    const q = document.getElementById("q");
    if (!q.value.trim()) return;
    vscode.postMessage({ typed: q.value.trim() });
    q.value = "";
  };
</script></body></html>`;
  }

  onMessage(m) {
    if (m.typed) return void say(m.typed);
    switch (m.op) {
      case "hello":
        if (m.ready && !this.ready) {
          this.ready = true;
          this.version = m.version || "";
          this.lang = m.lang || "";
          out.appendLine(t("Emkay is up{0}.", this.version ? ` (${this.version})` : "") +
            (this.lang ? " " + t("It speaks {0}.", this.lang) : ""));
          for (const r of this.readyWaiters.splice(0)) r();
          setStatus();
        }
        break;
      case "result": {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (w) m.ok ? w.resolve(m.result) : w.reject(new Error(m.error));
        break;
      }
      case "log": {
        const r = m.record;
        if (!r) break;
        const time = new Date(r.t * 1000).toLocaleTimeString();
        out.appendLine(`${time} ${r.level.padEnd(7)} ${r.mine ? "★ " : ""}${r.name}: ${r.msg}`);
        break;
      }
      case "bus":
        if (vscode.workspace.getConfiguration("emkay").get("busLog")) {
          try {
            const msg = JSON.parse(m.raw);
            busOut.appendLine(`${msg.type}  ${JSON.stringify(msg.data || {}).slice(0, 400)}`);
          } catch {}
        }
        onBus(m.raw);
        break;
    }
  }

  /** Wait until Emkay has booted (the first time: a few minutes). */
  whenReady() {
    return this.ready ? Promise.resolve() : new Promise((r) => this.readyWaiters.push(r));
  }

  /** One order to Emkay (see web/dev.js); resolves with its result. */
  async op(op, args = {}) {
    await this.whenReady();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.view.webview.postMessage({ toEmkay: { op, id, ...args } });
    });
  }
}

function openPanel(context) {
  if (!panel) panel = new Panel(context);
  else panel.view.reveal(vscode.ViewColumn.Beside, true);
  setStatus();
  return panel;
}

// ------------------------------------------------------- what Emkay says

/** Emkay's answers to a typed sentence go to the output, so you can read them too. */
function onBus(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === "speak" || msg.type === "ovos.utterance.speak") {
    out.appendLine(`🗣  Emkay: ${msg.data?.utterance ?? ""}`);
  } else if (msg.type === "recognizer_loop:utterance") {
    out.appendLine(`🙂 ${t("You")}: ${(msg.data?.utterances || []).join(" / ")}`);
  } else if (msg.type === "mycroft.skill.handler.error") {
    out.appendLine(`✗  ${msg.data?.name || ""}: ${msg.data?.exception || msg.data?.error || ""}`);
    out.show(true);
  }
}

// --------------------------------------------------------------- commands

async function run(context, { quiet = false } = {}) {
  const skill = await findSkill();
  if (!skill) {
    const pick = await vscode.window.showWarningMessage(
      t("There is no skill in this folder yet. Make one?"), t("New skill…"));
    if (pick) await vscode.commands.executeCommand("emkay.newSkill");
    return;
  }
  const p = openPanel(context);
  setStatus("$(sync~spin) " + t("Emkay: starting…"));
  try {
    const files = await filesOf(skill.folder);
    if (!p.ready) out.appendLine(t("Waiting for Emkay to start…"));
    setStatus("$(sync~spin) " + t("Emkay: loading {0}", skill.skillId));
    const r = await p.op("load", { skillId: skill.skillId, files, requirements: skill.requirements });
    lastRun = { skillId: skill.skillId, ok: r.ok };
    for (const line of r.log || []) out.appendLine("   " + line);
    if (r.ok) {
      out.appendLine(t("✓ {0} runs in Emkay ({1} s). Intents: {2}", skill.skillId, r.seconds, (r.intents || []).join(", ") || "–"));
      if (!quiet) vscode.window.setStatusBarMessage(t("✓ {0} runs in Emkay", skill.skillId), 4000);
      // what to say: in the language Emkay speaks, which is easy to get wrong
      if (p.lang) {
        const examples = await exampleSentences(skill.folder, p.lang);
        if (examples === null) {
          out.appendLine("⚠ " + t("Your skill has no sentences in {0}, the language Emkay speaks. Add locale/{0}/, or change Emkay's language in its settings.", p.lang));
          out.show(true);
        } else if (examples.length) {
          out.appendLine("💬 " + t("Emkay speaks {0}. Try saying: {1}", p.lang, examples.map((e) => `"${e}"`).join(" · ")));
          p.view.webview.postMessage({ hint: t("e.g. {0}", examples[0]) });
        }
      }
      out.appendLine("🧪 " + t("Test it: the beaker (Testing) in the bar on the left, or Ctrl+Shift+P → Emkay: Test the skill."));
      if (!quiet && !toldTests) {
        toldTests = true;
        vscode.window.showInformationMessage(t("✓ {0} runs in Emkay. Its test sentences are in the Testing view.", skill.skillId), t("Open tests"))
          .then((x) => x && vscode.commands.executeCommand("workbench.view.testing.focus"));
      }
    } else {
      out.appendLine(t("✗ {0} did not load:", skill.skillId));
      for (const p of r.problems || []) out.appendLine("   " + p);
      out.show(true);
      vscode.window.showErrorMessage(t("{0} did not load: {1}", skill.skillId, (r.problems || [])[0] || ""), t("Show Emkay's log"))
        .then((x) => x && out.show());
    }
  } catch (e) {
    out.appendLine("✗ " + e.message);
    vscode.window.showErrorMessage(e.message);
  } finally {
    setStatus();
  }
  await refreshTests();
}

async function say(text) {
  if (!panel) {
    vscode.window.showInformationMessage(t("Start Emkay first: Emkay: Run the skill in Emkay."));
    return;
  }
  out.show(true);
  await panel.op("say", { text });
}

async function stop() {
  if (!panel || !lastRun) return;
  await panel.op("unload", { skillId: lastRun.skillId });
  out.appendLine(t("{0} stopped; an installed copy (if any) answers again.", lastRun.skillId));
  lastRun = null;
}

// ------------------------------------------------------- send to my Emkay

/**
 * The workspace's GitHub repo: {owner, repo, ref}, or null. In vscode.dev
 * with a GitHub repo open (vscode-vfs://github/owner/repo) from the folder's
 * address; in a clone (Codespaces, VS Code on a PC) from .git/config's origin
 * and .git/HEAD's branch.
 */
async function githubOf(root) {
  if (root.scheme === "vscode-vfs" && /github/i.test(root.authority)) {
    const [, owner, repo] = root.path.split("/");
    if (owner && repo) return { owner, repo: repo.replace(/\+.*$/, ""), ref: "" };
  }
  const config = await readText(vscode.Uri.joinPath(root, ".git", "config"));
  const url = config && (config.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/) || [])[1];
  const gh = url && url.match(/github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  if (!gh) return null;
  const head = await readText(vscode.Uri.joinPath(root, ".git", "HEAD"));
  const branch = head && ((head.match(/ref: refs\/heads\/(.+)/) || [])[1] || "").trim();
  return { owner: gh[1], repo: gh[2], ref: branch || "" };
}

/** Files changed but not pushed, as VS Code's git sees them (null: can't tell, e.g. in vscode.dev). */
async function unpushed(root) {
  try {
    const ext = vscode.extensions.getExtension("vscode.git");
    if (!ext) return null;
    const api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
    const repo = api.repositories.find((r) => root.path.startsWith(r.rootUri.path));
    if (!repo) return null;
    const s = repo.state;
    return s.workingTreeChanges.length + s.indexChanges.length + (s.HEAD?.ahead || 0);
  } catch { return null; }
}

/**
 * Emkay: Send to my Emkay (emkay-voice/emkay#49): a QR code and a link,
 * app.emkay.ai/?install=github:owner/repo, that the device's camera (or the link) opens in
 * Emkay, which shows the skill and installs it from GitHub after a tap.
 * Only what is pushed goes, and the repo must be public: Emkay fetches it
 * from GitHub without a login.
 */
async function sendToEmkay(context) {
  const skill = await findSkill();
  if (!skill) {
    vscode.window.showWarningMessage(t("There is no skill in this folder yet. Make one?"), t("New skill…"))
      .then((x) => x && vscode.commands.executeCommand("emkay.newSkill"));
    return;
  }
  const gh = await githubOf(skill.root);
  if (!gh) {
    const publish = t("Publish to GitHub"), how = t("How?");
    const pick = await vscode.window.showInformationMessage(
      t("Your skill has to be on GitHub first: your Emkay fetches it from there."), publish, how);
    if (pick === publish) {
      vscode.commands.executeCommand("github.publish").then(undefined, () =>
        vscode.env.openExternal(vscode.Uri.parse("https://dev.emkay.ai/#github")));
    } else if (pick === how) {
      vscode.env.openExternal(vscode.Uri.parse("https://dev.emkay.ai/#github"));
    }
    return;
  }
  const waiting = await unpushed(skill.root);
  if (waiting) {
    const anyway = t("Send anyway");
    const pick = await vscode.window.showWarningMessage(
      t("You have changes that are not on GitHub yet ({0}). Your Emkay gets what is on GitHub – commit and push (Sync) first.", waiting),
      { modal: true }, anyway);
    if (pick !== anyway) return;
  }
  const base = new URL(vscode.workspace.getConfiguration("emkay").get("url") || "https://app.emkay.ai/");
  base.search = "";
  base.searchParams.set("install", `github:${gh.owner}/${gh.repo}${gh.ref ? `@${gh.ref}` : ""}`);
  const link = base.toString().replace("%3A", ":").replace(/%2F/g, "/").replace("%40", "@");
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  const view = vscode.window.createWebviewPanel("emkaySend", t("Send to my Emkay"),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true });
  view.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");
  const nonce = Math.random().toString(36).slice(2);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  view.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}';">
<style>
  body { font: 14px system-ui, sans-serif; color: var(--vscode-foreground); padding: 24px; max-width: 520px; margin: auto; text-align: center; }
  .qr { background: #fff; border-radius: 16px; padding: 12px; width: 280px; height: 280px; margin: 18px auto; }
  .qr svg { width: 100%; height: 100%; }
  h1 { font-weight: 400; font-size: 22px; } .repo { font-weight: 600; font-size: 16px; }
  p { line-height: 1.5; } .small { opacity: .75; font-size: 12px; }
  code { word-break: break-all; }
  button { padding: 8px 16px; border: 0; border-radius: 6px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
</style></head><body>
<h1>${esc(t("Send to my Emkay"))}</h1>
<div class="repo">${esc(`${gh.owner}/${gh.repo}`)}${gh.ref ? ` · ${esc(gh.ref)}` : ""}</div>
<div class="qr">${svg}</div>
<p><b>${esc(t("Scan it with the camera on the phone or tablet that runs Emkay – or open the link there."))}</b><br>${esc(t("Emkay opens and shows your skill. Tap Install – it stays on that Emkay, and Update in menu → From GitHub fetches your newest version."))}</p>
<p><code id="link">${esc(link)}</code><br><br><button id="copy">${esc(t("Copy link"))}</button></p>
<p class="small">${esc(t("The repository must be public, and only what you have pushed to GitHub goes to your Emkay."))}</p>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById("copy").onclick = () => vscode.postMessage({ copy: true });
</script></body></html>`;
  view.webview.onDidReceiveMessage(async (m) => {
    if (m.copy) {
      await vscode.env.clipboard.writeText(link);
      vscode.window.setStatusBarMessage(t("Copied"), 3000);
    }
  });
  out.appendLine("📱 " + t("Send to my Emkay") + ": " + link);
}

// ------------------------------------------------------------------ tests

/** The golden utterances as VS Code tests: the Testing view, ✓ and ✗ in the file. */
async function refreshTests() {
  const skill = await findSkill();
  tests.items.replace([]);
  if (!skill) return;
  const rows = await goldenRows(skill);
  const byLang = new Map();
  for (const r of rows) {
    if (!byLang.has(r.row.lang)) {
      const item = tests.createTestItem(`lang:${r.row.lang}`, r.row.lang, r.file);
      byLang.set(r.row.lang, item);
      tests.items.add(item);
    }
    const item = tests.createTestItem(`${r.row.lang}:${r.line}`, `“${r.row.utterance}”`, r.file);
    item.range = new vscode.Range(r.line, 0, r.line, 0);
    item.description = r.row.intent_label || "";
    item.row = r.row;
    byLang.get(r.row.lang).children.add(item);
  }
}

async function runTests(request, token, context) {
  const run = tests.createTestRun(request);
  const queue = [];
  const add = (item) => (item.row ? queue.push(item) : item.children.forEach(add));
  (request.include || [...gather(tests.items)]).forEach(add);
  if (!panel || !lastRun) await vscode.commands.executeCommand("emkay.run");
  if (!panel) { run.end(); return; }
  // "test everything": the sentences of the language Emkay speaks (padatious
  // has learned only those); a language picked in the Testing view still runs
  if (!request.include && panel.lang) {
    const mine = (l) => String(l).split("-")[0].toLowerCase() === panel.lang.split("-")[0].toLowerCase();
    const others = queue.filter((item) => !mine(item.row.lang)).length;
    if (others && others < queue.length) {
      queue.splice(0, queue.length, ...queue.filter((item) => mine(item.row.lang)));
      out.appendLine(t("Testing the sentences in {0}, the language Emkay speaks; change Emkay's language in its settings to test another.", panel.lang));
    }
  }
  out.appendLine(t("Testing {0} sentences…", queue.length));
  let passed = 0, skipped = 0;
  for (const item of queue) {
    if (token.isCancellationRequested) break;
    run.started(item);
    const t0 = Date.now();
    try {
      const v = await panel.op("test", { row: item.row });
      const said = (v.spoke || []).join(" ");
      const mark = { pass: "✓", skipped: "–" }[v.status] || "✗";
      const line = `${mark} [${item.row.lang}] “${item.row.utterance}” → ${v.detail}${said ? `  🗣 ${said}` : ""}`;
      out.appendLine(line);
      run.appendOutput(line + "\r\n", undefined, item);
      if (v.status === "skipped") { skipped++; run.skipped(item); }
      else if (v.status === "pass") { passed++; run.passed(item, Date.now() - t0); }
      else run.failed(item, new vscode.TestMessage(v.detail), Date.now() - t0);
    } catch (e) {
      run.errored(item, new vscode.TestMessage(e.message));
    }
  }
  out.appendLine(t("{0} of {1} passed.", passed, queue.length - skipped) +
    (skipped ? " " + t("{0} skipped: not in the language Emkay speaks ({1}).", skipped, panel.lang || "?") : ""));
  run.end();
}

function* gather(collection) { for (const [, item] of collection) yield item; }

// ------------------------------------------------------------- new skill

/**
 * The templates to choose from: dev.emkay.ai/templates/index.json (made from
 * emkay-voice/dev's templates.json, one repository per template), or – when
 * that can't be reached – the plain skill built into the extension.
 * @returns {Promise<{id, kind, icon, repo, name, description, url?, builtIn?}[]>}
 */
async function templates() {
  const base = vscode.workspace.getConfiguration("emkay").get("templates") || "https://dev.emkay.ai/templates/";
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(new URL("index.json", base), { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const list = await r.json();
      if (Array.isArray(list) && list.length) return list.map((x) => ({ ...x, url: new URL(x.url || `${x.id}.json`, base).toString() }));
    }
  } catch {}
  return [{ id: "skill", kind: "skill", icon: "👋", repo: "emkay-voice/ovos-skill-hello-example", builtIn: true,
            name: { en: "A plain skill", da: "En almindelig skill" },
            description: { en: "Say a sentence, get an answer – the smallest skill there is.",
                           da: "Sig en sætning, få et svar – den mindste skill der findes." } }];
}

const inLang = (o) => {
  const l = (vscode.env.language || "en").toLowerCase();
  return (o && (o[l] ?? o[l.split("-")[0]] ?? o.en)) || "";
};

/** A template's files with the new skill's names filled in: {path: Uint8Array}. */
async function templateFiles(tpl, name, author) {
  const n = template.names(name, author);
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => n[k] ?? m);
  const out = {};
  if (tpl.builtIn) {
    for (const [p, text] of Object.entries(template.render({ name, author }))) out[p] = new TextEncoder().encode(text);
    return out;
  }
  const r = await fetch(tpl.url);
  if (!r.ok) throw new Error(t("Could not fetch the template ({0}).", r.status));
  const bundle = await r.json();
  for (const [p, f] of Object.entries(bundle.files)) {
    out[fill(p)] = f.text !== undefined ? new TextEncoder().encode(fill(f.text))
      : Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
  }
  return out;
}

async function newSkill() {
  let ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    const pick = await vscode.window.showInformationMessage(
      t("Open (or make) an empty folder for your skill first – then run New skill again."), t("Open folder…"));
    if (pick) await vscode.commands.executeCommand("workbench.action.files.openFolder");
    return;
  }
  const list = await templates();
  let tpl = list[0];
  if (list.length > 1) {
    const picked = await vscode.window.showQuickPick(list.map((x) => ({
      label: `${x.icon || "🧩"} ${inLang(x.name)}`, detail: inLang(x.description), description: x.repo, tpl: x,
    })), { title: t("New skill"), placeHolder: t("What kind of skill?") });
    if (!picked) return;
    tpl = picked.tpl;
  }
  const name = await vscode.window.showInputBox({
    title: t("New skill"),
    prompt: t("What is your skill about? A few words, e.g. \"coffee facts\""),
    value: tpl.id === "skill" || !tpl.id ? "hello" : tpl.id,
    validateInput: (v) => /^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$/.test(v.trim()) ? null : t("Letters, numbers, spaces and dashes"),
  });
  if (!name) return;
  const author = await vscode.window.showInputBox({
    title: t("New skill"),
    prompt: t("Your name or GitHub user name (it goes into the skill's id)"),
    value: "",
    validateInput: (v) => /^[A-Za-z0-9-]{1,39}$/.test(v.trim()) ? null : t("Letters, numbers and dashes"),
  });
  if (!author) return;
  let files;
  try {
    files = keepLanguages(await templateFiles(tpl, name.trim(), author.trim()), panel?.lang || vscode.env.language);
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
    return;
  }
  const existing = [];
  for (const path of Object.keys(files)) {
    if (await exists(vscode.Uri.joinPath(ws.uri, path))) existing.push(path);
  }
  if (existing.length) {
    const ok = await vscode.window.showWarningMessage(
      t("{0} files are there already (e.g. {1}). Overwrite them?", existing.length, existing[0]), { modal: true }, t("Overwrite"));
    if (!ok) return;
  }
  for (const [path, bytes] of Object.entries(files)) {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(ws.uri, path), bytes);
  }
  const main = Object.keys(files).filter((p) => p.endsWith("__init__.py") && !/(^|\/)tests?\//.test(p))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  // the intent in the user's language (the one besides en-US that was kept)
  const intents = Object.keys(files).filter((p) => p.endsWith(".intent"));
  const intent = intents.find((p) => !/\/locale\/en-us\//i.test(p)) || intents.find((p) => /\/locale\/en-us\//i.test(p)) || intents[0];
  if (main) await vscode.window.showTextDocument(vscode.Uri.joinPath(ws.uri, main), { preview: false, viewColumn: vscode.ViewColumn.One });
  if (intent) await vscode.window.showTextDocument(vscode.Uri.joinPath(ws.uri, intent), { preview: false, viewColumn: vscode.ViewColumn.One });
  await updateContext();
  if (tpl.builtIn || tpl.kind === "skill" || tpl.id === "skill") {
    const first = intent ? firstOption(new TextDecoder().decode(files[intent]).split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) || "") : "";
    vscode.window.showInformationMessage(t("Your skill is made. Emkay starts next to it now – then type \"{0}\" below Emkay.", first || template.firstSentence(name.trim(), vscode.env.language)));
  } else {
    vscode.window.showInformationMessage(t("Your skill is made from {0}. Emkay starts next to it now; the template's README says what to try.", inLang(tpl.name)));
  }
  await vscode.commands.executeCommand("emkay.run");
}

// ----------------------------------------------------------- status, setup

function setStatus(text) {
  if (!status) return;
  if (text) status.text = text;
  else if (!panel) status.text = "$(play) Emkay";
  else if (!panel.ready) status.text = "$(sync~spin) " + t("Emkay: starting…");
  else status.text = lastRun?.ok ? `$(check) Emkay: ${lastRun.skillId}` : "$(play) Emkay";
  status.tooltip = t("Run the skill in Emkay (Ctrl+Alt+E)");
  status.command = "emkay.run";
  status.show();
}

async function updateContext() {
  const skill = await findSkill();
  await vscode.commands.executeCommand("setContext", "emkay.isSkill", !!skill);
  return skill;
}

function activate(context) {
  out = vscode.window.createOutputChannel("Emkay");
  busOut = vscode.window.createOutputChannel("Emkay bus");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  tests = vscode.tests.createTestController("emkay", "Emkay");
  tests.createRunProfile(t("Run in Emkay"), vscode.TestRunProfileKind.Run, (req, tok) => runTests(req, tok, context), true);
  tests.refreshHandler = () => refreshTests();
  context.subscriptions.push(out, busOut, status, tests);

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("emkay.open", () => openPanel(context));
  reg("emkay.run", () => run(context));
  reg("emkay.newSkill", () => newSkill());
  reg("emkay.stop", () => stop());
  reg("emkay.showLog", () => out.show());
  reg("emkay.send", () => sendToEmkay(context));
  reg("emkay.say", async (text) => {
    if (typeof text !== "string") {
      text = await vscode.window.showInputBox({ title: t("Say to Emkay"), prompt: t("Type what you would say") });
    }
    if (text) {
      if (!panel) await run(context, { quiet: true });
      await say(text);
    }
  });
  reg("emkay.test", async () => {
    await refreshTests();
    vscode.commands.executeCommand("workbench.view.testing.focus");
    out.show(true);
    const req = new vscode.TestRunRequest();
    const cts = new vscode.CancellationTokenSource();
    await runTests(req, cts.token, context);
  });

  // save -> run again (debounced: "save all" saves many files at once)
  let timer = null;
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
    if (!panel || !vscode.workspace.getConfiguration("emkay").get("reloadOnSave")) return;
    const skill = await findSkill();
    if (!skill) return;
    const inSkill = doc.uri.path.startsWith(skill.folder.path + "/") || /golden_utterances_.*\.jsonl$/.test(doc.uri.path)
      || /(pyproject\.toml|requirements\.txt)$/.test(doc.uri.path);
    if (!inSkill) return;
    clearTimeout(timer);
    timer = setTimeout(() => run(context, { quiet: true }), 400);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => updateContext()));
  updateContext().then((skill) => {
    setStatus();
    if (skill) refreshTests();
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
