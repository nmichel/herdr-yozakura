#!/bin/bash
# Copies the yozakura layout from a Herdr home into this folder, laid out as Herdr shares
# layouts (layouts/, mods/, themes/, backgrounds/). Run it again after changing the layout in
# Herdr to refresh this copy. RECIPE.md, preview.png and extras/ are this folder's own,
# except extras/claude-statusline.sh, refreshed from ~/.claude/statusline.sh when present.
#   ./export.sh                 # from ~/.config/herdr-app
#   HERDR_APP_HOME=... ./export.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mods=(yozakura-agents yozakura-changes yozakura-chrome yozakura-files yozakura-gauges yozakura-history yozakura-new-menu yozakura-pane
      yozakura-spaces yozakura-status yozakura-tabs)

mkdir -p "$here/layouts" "$here/mods" "$here/themes" "$here/backgrounds" "$here/extras"
cp "$home/layouts/yozakura.json" "$home/layouts/yozakura.svg" "$here/layouts/"
# The layout's three themes, each with its sky (backgrounds/<theme>.png, and the SVG it's from).
for theme in tsukiyo yugure harugasumi; do
  cp "$home/themes/$theme.json" "$here/themes/"
  cp "$home/backgrounds/$theme.png" "$home/backgrounds/$theme.svg" "$here/backgrounds/"
done
for m in "${mods[@]}"; do
  # The app (and `herdr-app check`) writes gpui-kit.d.ts and jsconfig.json into every mod
  # folder: not part of the mod, removed here too.
  rsync -a --delete --delete-excluded --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude '.*' "$home/mods/$m/" "$here/mods/$m/"
done
if [ -f "$home/backgrounds/yozakura.py" ]; then
  cp "$home/backgrounds/yozakura.py" "$here/extras/yozakura-background.py"
fi
if [ -f "$home/backgrounds/shoji.py" ]; then
  cp "$home/backgrounds/shoji.py" "$here/extras/shoji-textures.py"
fi
if [ -f "$HOME/.claude/statusline.sh" ]; then
  sed 's#islands-workspace-status#yozakura-status#' "$HOME/.claude/statusline.sh" > "$here/extras/claude-statusline.sh"
  chmod +x "$here/extras/claude-statusline.sh"
fi
echo "exported from $home to $here"
