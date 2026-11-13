# Yozakura, a Herdr layout

Night-time cherry blossoms for [Herdr](https://herdr.dev): desktops and panels as thumbnails,
agents with a dancer while they work, a pink-tinted title on the focused panel.
What it is and how it's built: [RECIPE.md](RECIPE.md).

![Yozakura](preview.png)

## Install

Ask your coding agent to add this layout (it follows Herdr's own instructions for shared
layouts), or copy it by hand into your Herdr home, without overwriting anything:

```sh
cp -Rn layouts mods themes backgrounds ~/.config/herdr-app/
herdr-app do layout.switch --name yozakura
```

`ctrl-shift-l` cycles back to your previous layout; deleting the copied files removes it.

The mods run `git` (the spaces list), `hc machine ls`, and `hc get` and `ps` (the agents list,
to see the commands Claude Code runs in the background); they read their own `settings.json`
and Herdr's `programs.json`, and reach no network.

## Agents in the + menu

The + button lists the agents Herdr knows (Claude Code, Codex…), as Herdr's own menu does. To
start agents of your own, or one agent in several setups (two Claude accounts), add them to
`~/.config/herdr-app/programs.json`, Herdr's program table: every entry with a `run` shows in
the menu, and replaces the built-in agent that starts the same command.
`extras/programs.example.json` sets up two Claude accounts, each with its own
`CLAUDE_CONFIG_DIR` (put your own folder in it). The menu doesn't expand shell aliases: use
`env`, a script or a shell function. Herdr's `AGENTS.md`, in its home folder, has the other fields.

## Extras

- `extras/claude-statusline.sh`: Claude Code's status line, which also writes the `claude.*`
  labels the agent cards and the status bar show (model, context, 5-hour and 7-day usage, the
  account's email). Copy it to `~/.claude/statusline.sh` and set `"statusLine": {"type":
  "command", "command": "~/.claude/statusline.sh"}` in `~/.claude/settings.json`. Needs `jq`
  and `hc`. With several accounts (a `CLAUDE_CONFIG_DIR` each), give each one this status line:
  the status bar keeps each account's usage apart by its email.
- `extras/programs.example.json`: two Claude accounts in the + menu (see above).
- `extras/yozakura-background.py`: draws the background as an SVG
  (`python3 extras/yozakura-background.py out.svg`), to change and render again.
- `extras/cropgif.swift`: crops an animated GIF to its figure (macOS, ImageIO), to add a
  dancer of your own; its header says how.
- `mods/yozakura-chrome/settings.json`: `opacity` (cards) and `main_opacity` (panes), 0 to 1.

## Updating this folder

`./export.sh` copies the layout back from `~/.config/herdr-app` (or `$HERDR_APP_HOME`) after
changing it in Herdr.

## License

MIT ([LICENSE](LICENSE)) for Yozakura's own work. The mods are adapted from Herdr's shipped
mods (Apache License 2.0) and the icons come from Herdr and Lucide (ISC): see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
