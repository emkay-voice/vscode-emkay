# Changelog

## 0.1.8

- **Emkay: Show in See my skill**: puts your skill in [See my skill](https://dev.emkay.ai/gallery/) on dev.emkay.ai – it adds the topic `emkay-skill` to the skill's GitHub repository with your own GitHub sign-in, after asking, and tells you if the repository is private or not on GitHub yet. Run it again to take the skill away. Nothing made from a template is shown unless its owner asks for it.

## 0.1.7

- *New skill* offers a **PHAL plugin** template too (quiet hours: the device's voice down in the evening, up in the morning – over the bus, with its own settings). A plugin made from it is named `ovos-phal-plugin-<your words>`, with a `…Plugin` class, and runs in Emkay next to the code.

## 0.1.6

- **PHAL plugins** run in Emkay too: a folder whose `pyproject.toml` has an `opm.phal` entry point is started the way OpenVoiceOS' PHAL service starts a plugin – its validator is asked, it gets the bus and its `PHAL.<id>` settings – and every save restarts it. The output says which bus messages it handles. Plugins that only use the bus and the network work; ones that need the device's hardware (sound cards, GPIO, system services) can't in a browser.

## 0.1.5

- **Emkay: Get help** opens dev.emkay.ai's help, in VS Code's language: what to do when the skill doesn't answer or another skill does, where the tests and the log are, where to ask (OpenVoiceOS on Matrix, Emkay Dev's discussions) and where to read (OVOS' manual, the sentence template grammar).

## 0.1.4

- **Emkay: Add language…**: translates your skill's English into one of Emkay's languages – on your own device, in Emkay next to the code, with the models and the rules OpenVoiceOS' ovos-localize uses: `{slots}` are never touched, each `(a|b)` alternative is translated on its own, a line that does not come back whole is left out (and listed with the reason), and ovos-localize's checks run on the result. The first time, the language's model is downloaded (about 100–300 MB) and kept. It writes `locale/<language>/` and test sentences for it, and suggests OVOS' commit message for a machine's translation – have someone who speaks the language read it through.
- *New skill*: a template suggests its own name (quiz, web, screen), and every skill template ends with the sentence to try.
- The plain template is `emkay-voice/ovos-skill-hello-example` now; its `publish.yml` publishes the skills made from it.

## 0.1.3

- **Emkay: Send to my Emkay**: a QR code and a link that install the skill from GitHub on the Emkay you scan it with (a phone, a tablet…), with Update and Remove under menu → From GitHub there. It finds the repository from vscode.dev/github/… or from git, warns about changes not pushed yet, and offers *Publish to GitHub* when the skill is not on GitHub.

## 0.1.2

- *New skill* makes the skill in English and in your own language (Emkay's, else VS Code's), not in all twelve; more languages come later with *Add language*.
- The template's intents have 10+ sentences each, written with (a|b) alternatives, and pass OpenVoiceOS' translation checks (ovos-localize).
- After a run: where the tests are (the beaker on the left), and once a session a button that opens them.

## 0.1.1

- After a run, the output says which language Emkay speaks and gives a few sentences to try from your skill (the typing line shows one too). If the skill has no sentences in that language, it says so.
- Tests run only the sentences in Emkay's language; the rest are skipped, with the reason.
- New skills from the built-in template ask for Emkay Dev in their devcontainer.
- Works in vscode.dev, where Emkay is now allowed in the panel.

## 0.1.0

The first release: Emkay next to your code (`?dev`), *New skill* from the dev.emkay.ai templates, run on save, typing to Emkay, Emkay's log, golden utterances in the Testing view. All twelve of Emkay's languages.
