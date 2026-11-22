// Make template.js from the skill template repository (emkay-voice/ovos-skill-hello-example),
// so "Emkay: New skill" writes exactly the files that template has.
//
//   node tools/sync-template.mjs ../emkay-skill-template
//
// The template's names become placeholders that render() fills in:
//   emkay-voice/ovos-skill-hello-example  {{repo}}   (first: the name is part of it)
//   ovos-skill-hello-example.emkay-voice  {{id}}     ovos_skill_hello_example  {{module}}
//   ovos-skill-hello-example              {{name}}   HelloSkill                {{Class}}
//   "name": "Hello"                       {{Title}}
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
  .replaceAll("emkay-voice/ovos-skill-hello-example", "{{repo}}")
  .replaceAll("ovos-skill-hello-example.emkay-voice", "{{id}}")
  .replaceAll("ovos_skill_hello_example", "{{module}}")
  .replaceAll("ovos-skill-hello-example", "{{name}}")
  .replaceAll("HelloSkill", "{{Class}}")
  .replaceAll('authors = [{name = "emkay-voice"}]', 'authors = [{name = "{{author}}"}]')
  .replaceAll('"author": "emkay-voice"', '"author": "{{author}}"')
  .replaceAll('"name": "Hello"', '"name": "{{Title}}"')
  .replaceAll('"name": "Hej"', '"name": "{{Title}}"');

const out = {};
for (const [p, text] of Object.entries(files)) out[placeholders(p)] = placeholders(text);

const js = `// Made by tools/sync-template.mjs from emkay-voice/ovos-skill-hello-example – do not edit by hand.
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
  // "(hello|hi) from my (skill|first skill)" -> "hello from my skill"
  let s = text.split("\\n")[0], prev;
  do { prev = s; s = s.replace(/\\(([^()|]*)(\\|[^()]*)?\\)/g, "$1"); } while (s !== prev);
  return s.replace(/\\s+/g, " ").trim();
}

module.exports = { render, firstSentence, names };
`;
fs.writeFileSync(new URL("../template.js", import.meta.url), js);
console.log(`template.js: ${Object.keys(out).length} files from ${src}`);
