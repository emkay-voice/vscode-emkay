# Changelog

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
