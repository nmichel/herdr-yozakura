#!/bin/bash
input=$(cat)

dir=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')
# Strip the trailing context-size parenthetical, e.g. "Opus 4.8 (1M context)" -> "Opus 4.8"
model="${model%% (*}"
branch=$(git -C "$dir" branch --show-current 2>/dev/null)
pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
used_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
max_tokens=$(echo "$input" | jq -r '.context_window.context_window_size // 0')

# Round to integer
pct=$(printf '%.0f' "$pct")

# Tokens in kilo-tokens
used_k=$(( used_tokens / 1000 ))
max_k=$(( max_tokens / 1000 ))

reset=$'\033[0m'

# gauge <integer percent>: prints a colored 10-segment bar.
# Color by threshold: green < 50, yellow 50-79, red >= 80
gauge() {
  local p=$1 segments=10 color bar="" i filled
  if (( p >= 80 )); then
    color=$'\033[31m'   # red
  elif (( p >= 50 )); then
    color=$'\033[33m'   # yellow
  else
    color=$'\033[32m'   # green
  fi
  filled=$(( p * segments / 100 ))
  for ((i = 0; i < segments; i++)); do
    if (( i < filled )); then
      bar="${bar}█"
    else
      bar="${bar}░"
    fi
  done
  printf '%s%s%s' "$color" "$bar" "$reset"
}

# colored_pct <integer percent>: prints "NN%" in the gauge's color
colored_pct() {
  local p=$1 color
  if (( p >= 80 )); then
    color=$'\033[31m'
  elif (( p >= 50 )); then
    color=$'\033[33m'
  else
    color=$'\033[32m'
  fi
  printf '%s%s%%%s' "$color" "$p" "$reset"
}

# Rate limits (subscribers only, absent before the first API response): 5-hour session and 7-day week
five=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
limits=""
if [ -n "$five" ]; then
  five=$(printf '%.0f' "$five")
  limits=" │ 5h $(gauge "$five") $(colored_pct "$five")"
fi
if [ -n "$week" ]; then
  week=$(printf '%.0f' "$week")
  limits="${limits} │ 7j $(gauge "$week") $(colored_pct "$week")"
fi

# Herdr: the same figures as labels on this agent's terminal, for Herdr's status bar
# (~/.config/herdr-app/mods/yozakura-status). Written only when they change,
# since each label write redraws Herdr. Not in the background (a call takes ~20 ms):
# Claude Code ends what the status line leaves behind. Cached only once written.
# Once Herdr has them, its bar shows them: this line stays empty. If the write fails,
# the line shows as usual, so the figures are never lost.
# `claude.email`: the account's email, from the config Claude runs with
# ($CLAUDE_CONFIG_DIR/.claude.json, else ~/.claude.json), shown on Herdr's agent cards; its
# status bar keeps each account's 5h and 7-day usage apart by it.
if [ -n "$HC_TERMINAL_ID" ] && command -v hc >/dev/null 2>&1; then
  account_file="${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}"
  email=$(jq -r '.oauthAccount.emailAddress // empty' "${account_file:-$HOME/.claude.json}" 2>/dev/null)
  herdr=(
    "claude.email=$email" "claude.model=$model"
    "claude.ctx_used=$used_tokens" "claude.ctx_size=$max_tokens" "claude.ctx_pct=$pct"
    "claude.five=$five" "claude.five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')"
    "claude.week=$week" "claude.week_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')"
  )
  cache="${TMPDIR:-/tmp}/claude-herdr-$HC_TERMINAL_ID"
  if [ "$(cat "$cache" 2>/dev/null)" = "${herdr[*]}" ]; then
    exit 0
  fi
  if hc label "$HC_TERMINAL_ID" "${herdr[@]}" "claude.at=$(date +%s)" >/dev/null 2>&1; then
    printf '%s' "${herdr[*]}" > "$cache"
    exit 0
  fi
fi

echo "📁 ${dir##*/} 🌿 ${branch:-no-branch} │ ${model} $(gauge "$pct") (${used_k}k/${max_k}k) $(colored_pct "$pct")${limits}"
