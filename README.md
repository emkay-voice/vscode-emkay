# Emkay Dev

Write an [OpenVoiceOS](https://openvoiceos.org) skill and talk to it a
second later. [Emkay](https://emkay.ai) – a full OpenVoiceOS that runs in a
web page – opens next to your code, runs your skill, and runs it again
every time you save. Works in VS Code on your PC, in Codespaces, and in the
browser: [vscode.dev](https://vscode.dev) and github.dev.

**👉 Getting started, step by step: <https://dev.emkay.ai>**

## What it does

- **Emkay: New skill…** – pick a template (a plain skill, a reading
  provider, …), name it, and get a working skill in the open folder. The
  templates come from [dev.emkay.ai](https://dev.emkay.ai), one repository
  each; without a connection, the plain skill built into the extension.
- **Emkay: Run the skill in Emkay** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd>,
  or ▷ in the editor title) – Emkay opens in a panel next to the code and
  loads the skill from its files, the way ovos-core loads a skill from a
  folder. Its requirements are installed in Emkay. Saving a file of the
  skill runs it again.
- **Type to Emkay** in the line under the panel (or **Emkay: Say
  something…**, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd>), and hear the
  answer. What you said and what Emkay answered show in the **Emkay**
  output, with Emkay's log: your skill's lines (★, DEBUG too), OVOS' lines
  about loading skills and matching intents, and every warning and error.
- **Emkay: Test the skill** – the skill's golden utterances
  (`test/end2end/golden_utterances_<lang>.jsonl`) in VS Code's Testing
  view: ✓ when a sentence reaches your skill, ✗ with who took it
  instead. Judged by [ovos-routing-judge](https://pypi.org/project/ovos-routing-judge/),
  like [ovos-tui-client](https://github.com/andlo/ovos-tui-client) and the
  [Emkay store](https://store.emkay.ai)'s checks, so a sentence passes or
  fails the same in all three. Sentences in another language than Emkay
  speaks are skipped.
- **Emkay bus** output (setting `emkay.busLog`): every message on Emkay's
  bus.

The dev Emkay in the panel has its own storage: it never touches the Emkay
you use day to day.

## Settings

| Setting | |
|---|---|
| `emkay.url` | The Emkay to use (default `https://app.emkay.ai/`). An Emkay from your house (Emkay Home) or `http://localhost:8080/` work too. |
| `emkay.reloadOnSave` | Run the skill again on every save (default on). |
| `emkay.busLog` | Show every bus message in the "Emkay bus" output. |
| `emkay.templates` | Where *New skill* finds its templates. |

## Good to know

- Emkay runs OpenVoiceOS with Pyodide (WebAssembly). Pure-Python packages
  install fine; a native package without a WebAssembly build can't, and
  the skill says so when it loads.
- The microphone isn't available inside a VS Code panel: talk by typing.
  Sound out works – tap *Start* in Emkay once.
- The first start downloads OpenVoiceOS into the browser (a few minutes);
  after that it starts much faster.

## How it works

The panel frames Emkay with `?dev` and talks to it with `postMessage`
(Emkay's side: [`web/dev.js`](https://github.com/emkay-voice/emkay/blob/main/web/dev.js)
and [`py/emkay_mobile/dev.py`](https://github.com/emkay-voice/emkay/blob/main/py/emkay_mobile/dev.py)).
The extension is plain JavaScript using only the VS Code API, so the same
file runs on a PC and in a browser; `tools/build.mjs` puts it in one file
(`dist/extension.js`), as a web extension must be.

```
npm run sync-template   # template.js from ../emkay-skill-template
npm run build           # dist/extension.js
npm run package         # emkay-dev-<version>.vsix
```

Part of [Emkay Dev](https://github.com/emkay-voice/emkay/issues/43).
Apache 2.0.
