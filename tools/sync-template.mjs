// Make template.js from the skill template repository (emkay-voice/skill-template),
// so "Emkay: New skill" writes exactly the files that template has.
//
//   node tools/sync-template.mjs ../emkay-skill-template
//
// The template's names become placeholders that render() fills in:
//   ovos-skill-hello.emkay-voice  {{id}}       ovos_skill_hello  {{module}}
//   ovos-skill-hello              {{name}}     HelloSkill        {{Class}}
//   emkay-voice/skill-template    {{repo}}     "name": "Hello"   {{Title}}
import fs from "fs";
import path from "path";

const src = path.resolve(process.argv[2] || "../emkay-skill-template");
const SKIP = new Set([".git", "__pycache__", ".pytest_cache", "make-it-yours.yml"]);
const files = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.endsWith(".egg-info")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files[path.relative(src, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8");
  }
})(src);

const placeholders = (s) => s
  .replaceAll("ovos-skill-hello.emkay-voice", "{{id}}")
  .replaceAll("ovos_skill_hello", "{{module}}")
  .replaceAll("ovos-skill-hello", "{{name}}")
  .replaceAll("HelloSkill", "{{Class}}")
  .replaceAll("emkay-voice/skill-template", "{{repo}}")
  .replaceAll('authors = [{name = "emkay-voice"}]', 'authors = [{name = "{{author}}"}]')
  .replaceAll('"name": "Hello"', '"name": "{{Title}}"')
  .replaceAll('"name": "Hej"', '"name": "{{Title}}"');

const out = {};
for (const [p, text] of Object.entries(files)) out[placeholders(p)] = placeholders(text);

const js = `// Made by tools/sync-template.mjs from emkay-voice/skill-template – do not edit by hand.
// "Emkay: New skill" writes these files, with the skill's own names filled in.
const FILES = ${JSON.stringify(out, null, 1)};

/** "coffee facts" -> the names a skill package needs. */
function names(name, author) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-skill";
  const pkg = slug.startsWith("ovos-skill-") ? slug : \`ovos-skill-\${slug}\`;
  const words = slug.replace(/^ovos-skill-/, "").split("-").filter(Boolean);
  const owner = author.toLowerCase();
  return {
    name: pkg,
    module: pkg.replace(/-/g, "_"),
    id: \`\${pkg}.\${owner}\`,
    Class: words.map((w) => w[0].toUpperCase() + w.slice(1)).join("") + "Skill",
    Title: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
    repo: \`\${author}/\${pkg}\`,
    author,
  };
}

/** {path: text} for a new skill. */
function render({ name, author }) {
  const n = names(name, author);
  const fill = (s) => s.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => n[k] ?? _);
  const files = {};
  for (const [p, text] of Object.entries(FILES)) files[fill(p)] = fill(text);
  return files;
}

/** The first sentence to say to the new skill, in VS Code's language (the
 * template's first hello.intent line for it; English when it has none). */
function firstSentence(name, lang = "en") {
  const l = String(lang).toLowerCase();
  const key = Object.keys(FILES).find((p) => p.endsWith("/hello.intent") &&
    (p.toLowerCase().includes(\`/locale/\${l}/\`) || p.toLowerCase().includes(\`/locale/\${l.split("-")[0]}-\`)));
  const text = FILES[key] || FILES[Object.keys(FILES).find((p) => p.endsWith("en-US/hello.intent"))] || "hello from my skill";
  return text.split("\\n")[0];
}

module.exports = { render, firstSentence, names };
`;
fs.writeFileSync(new URL("../template.js", import.meta.url), js);
console.log(`template.js: ${Object.keys(out).length} files from ${src}`);
