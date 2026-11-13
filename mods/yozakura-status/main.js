// Yozakura: adapted from Herdr's shipped "workspace-status" mod (Apache License 2.0), changed for this layout.
// See THIRD_PARTY_NOTICES.md in the yozakura repository.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, focused, panes, home, theme, shared } from "herdr";

// The cards' fill at the opacity in yozakura-chrome/settings.json (1 when unset).
const islandFill = (c) => {
  const o = shared("yozakura.opacity");
  if (typeof o !== "number" || o >= 1 || !/^#[0-9a-f]{6}$/i.test(c)) return c;
  return c + Math.round(Math.max(0, o) * 255).toString(16).padStart(2, "0");
};

// The agents' activity, as in yozakura-agents: working spins, blocked (waiting for you)
// warns, idle and done show a green dot.
function status(t, s) {
  const slot = h_flex().size(14).flex_none().items_center().justify_center();
  if (s === "working") return slot.child(svg("mods/yozakura-chrome/spinner.svg").size(12).text_color(t.working).spin(900));
  if (s === "blocked") return slot.child(svg("mods/yozakura-agents/warning.svg").size(14).text_color(t.blocked));
  return slot.child(div().size(8).rounded(4).bg(t.ansi2));
}

// Claude Code's status line figures, which ~/.claude/statusline.sh writes as `claude.*`
// labels on its agent's terminal: the context window of the agent in view (the focused
// pane's, else the agent Herdr shows), and the account's 5-hour and 7-day usage from
// whichever Claude terminal of that account wrote last. Accounts go by their email (the
// `claude.email` label), so two subscriptions' usage never mix, whatever their number.
// A window past its reset time counts as 0%.
function usage(all, f) {
  const claude = all.filter(k => k.state === "live" && k.labels?.["claude.at"]);
  if (!claude.length) return null;
  const n = (k, key) => (k.labels[key] ? Number(k.labels[key]) : null);
  const shown = claude.find(k => k.address === f?.terminal) ?? claude.find(k => k.address === f?.agent);
  const account = (k) => k.labels["claude.email"] ?? "";
  const same = shown ? claude.filter(k => account(k) === account(shown)) : claude;
  const latest = same.reduce((a, b) => (n(b, "claude.at") > n(a, "claude.at") ? b : a));
  const now = Date.now() / 1000;
  const limit = (key) => {
    const pct = n(latest, `claude.${key}`);
    if (pct === null) return null;
    const reset = n(latest, `claude.${key}_reset`);
    return reset !== null && now >= reset ? 0 : pct;
  };
  return {
    context: shown && n(shown, "claude.ctx_size") ? {
      model: shown.labels["claude.model"] ?? "",
      used: n(shown, "claude.ctx_used") ?? 0,
      size: n(shown, "claude.ctx_size"),
      pct: n(shown, "claude.ctx_pct") ?? 0,
    } : null,
    five: limit("five"),
    week: limit("week"),
  };
}

// The status line's thresholds and its ANSI colors: green under 50%, yellow to 79%, red from 80%.
const level = (t, p) => (p >= 80 ? t.ansi1 : p >= 50 ? t.ansi3 : t.ansi2);
const GAUGE = 56;
function gauge(t, p) {
  const fill = Math.round((GAUGE * Math.min(100, Math.max(0, p))) / 100);
  return div().w(GAUGE).h(7).flex_none().rounded(2).overflow_hidden().bg(t.input)
    .child(div().h_full().w(fill).bg(level(t, p)));
}

export default class WorkspaceStatus extends View {
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const f = focused();
    const u = usage(terminals(), f);
    // The folder and branch of the terminal in view, as Claude's status line shows its own;
    // without one (a mod pane), the space's branch alone.
    const pane = panes().find(p => p.pane === f?.pane);
    const cwd = pane ? pane.cwd : f?.cwd ?? null;
    const branch = pane?.cwd ? pane.branch : space?.branch;
    const dir = cwd && (cwd === home() ? "~" : cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop());
    // "label [gauge] (detail) NN%", as in the status line; the percentage in the gauge's color.
    const meter = (name, p, detail = null) => h_flex().gap(6).items_center()
      .when(Boolean(name), el => el.child(div().text_color(t.muted).child(name)))
      .child(gauge(t, p))
      .when(Boolean(detail), el => el.child(div().text_color(t.dim).child(detail)))
      .child(div().text_color(level(t, p)).child(`${Math.round(p)}%`));
    const working = list.filter(a => a.status === "working").length;
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text, color) => h_flex().gap(6).items_center().child(svg(`mods/yozakura-chrome/${icon}.svg`).size(13).text_color(color)).child(text); // colored icon, muted text
    // A count behind its status icon, left out when there are none.
    const count = (s, text, color = t.muted) => h_flex().gap(5).items_center().child(status(t, s)).child(div().text_color(color).child(text));
    return h_flex().size_full().px(14).gap(16).items_center().rounded(13).overflow_hidden().bg(islandFill(t.chrome)).text_size(11.8).text_color(t.muted) // its own card, no divider
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer", t.working))
      .when(Boolean(dir), el => el.child(label("folder", dir, t.ansi4)))
      .when(Boolean(branch), el => el.child(label("branch", branch, t.accent)))
      // Every agent, then how many work and how many wait for you.
      .child(h_flex().gap(12).items_center()
        .child(list.length === 1 ? "1 agent" : `${list.length} agents`)
        .when(working > 0, el => el.child(count("working", `${working} working`)))
        .when(needs > 0, el => el.child(count("blocked", `${needs} needs you`, t.blocked))))
      // On the right: Claude's context window, then the 5-hour session and the 7-day week.
      .when(Boolean(u), el => el.child(div().flex_1())
        .when(Boolean(u.context), el => el.child(meter(u.context.model, u.context.pct,
          `(${Math.floor(u.context.used / 1000)}k/${Math.floor(u.context.size / 1000)}k)`)))
        .when(u.five !== null, el => el.child(meter("5h", u.five)))
        .when(u.week !== null, el => el.child(meter("7j", u.week))));
  }
}
