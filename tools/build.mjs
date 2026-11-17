// One file for VS Code: dist/extension.js = template.js + extension.js.
//
// A web extension (vscode.dev, github.dev) runs as one script in a web worker
// and cannot require() its own other files, so the two are put in one file,
// each in its own function scope, with a require() that knows "./template.js"
// and hands everything else ("vscode") to the real one.
//
//   node tools/build.mjs
import fs from "fs";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const wrap = (name, src) => `  ${JSON.stringify(name)}: function (module, exports, require) {\n${src}\n  },`;
const out = `// Built by tools/build.mjs from extension.js and template.js – edit those.
"use strict";
(function () {
const outerRequire = typeof require === "function" ? require : undefined;
const sources = {
${wrap("./template.js", read("template.js"))}
${wrap("./extension.js", read("extension.js"))}
};
const cache = {};
function localRequire(name) {
  if (!(name in sources)) return outerRequire(name);
  if (!cache[name]) {
    const module = { exports: {} };
    cache[name] = module;
    sources[name](module, module.exports, localRequire);
  }
  return cache[name].exports;
}
module.exports = localRequire("./extension.js");
})();
`;
fs.mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../dist/extension.js", import.meta.url), out);
console.log(`dist/extension.js: ${out.length} bytes`);
