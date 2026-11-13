// Yozakura: adapted from Herdr's shipped "pane" mod (Apache License 2.0), changed for this layout.
// See THIRD_PARTY_NOTICES.md in the yozakura repository.
// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "yozakura-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
// While a tab or an agent card is dragged, it shows drop zones instead (see dock()).

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, terminals, props, run, theme, home, shared, setShared, notify } from "herdr";

// The header at "main_opacity" in yozakura-chrome/settings.json (1 when unset), like the pane under it.
const mainFill = (c) => {
  const o = shared("yozakura.mainOpacity");
  if (typeof o !== "number" || o >= 1 || !/^#[0-9a-f]{6}$/i.test(c)) return c;
  return c + Math.round(Math.max(0, o) * 255).toString(16).padStart(2, "0");
};

// `a` with a share `k` of `b` (both #rrggbb); else `a`.
function mix(a, b, k) {
  const pa = /^#([0-9a-f]{6})$/i.exec(a ?? ""), pb = /^#([0-9a-f]{6})$/i.exec(b ?? "");
  if (!pa || !pb) return a;
  const ca = parseInt(pa[1], 16), cb = parseInt(pb[1], 16);
  const ch = (s) => Math.round(((ca >> s) & 255) * (1 - k) + ((cb >> s) & 255) * k).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// The agent's activity, as in yozakura-agents: working spins, blocked (waiting for you)
// warns, idle and done show a green dot (a green spinner while background commands run).
// A pane without an agent has no status.
function status(t, s, busy = false) {
  const slot = h_flex().size(14).flex_none().items_center().justify_center();
  if (s === "working") return slot.child(svg("mods/yozakura-chrome/spinner.svg").size(12).text_color(t.working).spin(900));
  if (s === "blocked") return slot.child(svg("mods/yozakura-agents/warning.svg").size(14).text_color(t.blocked));
  // Idle, with commands still running in its background (yozakura-agents finds them): the
  // spinner, in idle green.
  if (busy) return slot.child(svg("mods/yozakura-chrome/spinner.svg").size(12).text_color(t.ansi2).spin(900));
  return slot.child(div().size(8).rounded(4).bg(t.ansi2));
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// Docking. A tab (yozakura-tabs) or an agent card (yozakura-agents) being dragged sets the
// shared "yozakura.dock.drag" to { terminal, tab }. Meanwhile every other pane's header turns into
// four zones; letting go on one docks that terminal on that side of the pane. A release
// elsewhere leaves the zones up (a click on one still docks); any other press clears them.
const SIDES = [
  { id: "left", text: "← Left" },
  { id: "top", text: "↑ Top" },
  { id: "bottom", text: "↓ Bottom" },
  { id: "right", text: "Right →" },
];

// The core applies terminal changes a moment later: wait for it (50 ms steps, 3 s by default).
async function until(cx, ok, ms = 3000) {
  for (let i = 0; i < ms / 50 && !ok(); i++) await cx.sleep(50);
  return ok();
}
const paneOf = (terminal) => panes().find((p) => p.terminal === terminal)?.pane ?? null;
const coreOf = (terminal) => terminals().find((k) => k.address === terminal && k.state === "live") ?? null;

// A moved terminal is never left without a pane. terminal.park answers at once but finishes
// in the core later: the core then drops the terminal's space and tab labels and its keep.
// A terminal.keep sent before that is lost (the terminal still has its pane), then the park
// lands: the terminal runs on, in no tab and in no list. So each step waits for the core:
// parked = no pane and no tab label left; placed = a pane and its tab label.
const parked = (terminal) => {
  const k = coreOf(terminal);
  return Boolean(k) && !paneOf(terminal) && !k.labels?.["herdr.tab"] && k.keep !== true;
};
const placed = (terminal) => Boolean(paneOf(terminal)) && Boolean(coreOf(terminal)?.labels?.["herdr.tab"]);

// Takes a terminal's pane away (terminal.park; a tab left empty closes); it keeps running.
async function lift(cx, terminal) {
  if (!paneOf(terminal)) return true;
  run("terminal.park", { terminal });
  return until(cx, () => parked(terminal), 5000);
}

// A move that didn't land: the terminal goes back to a tab of its own (its thumbnail at the
// top, its card in the agents list) once its park is over. Failing that, the toast does it
// when clicked. An ended terminal has nothing to bring back.
async function rescue(cx, terminal, what) {
  for (let i = 0; i < 3; i++) {
    if (!coreOf(terminal) || placed(terminal)) return;
    if (!(await until(cx, () => parked(terminal) || placed(terminal), 5000)) || placed(terminal)) continue;
    run("terminal.keep", { terminal });
    if (await until(cx, () => placed(terminal), 5000)) return;
  }
  if (!coreOf(terminal) || placed(terminal)) return;
  notify({
    title: `Couldn't ${what} the terminal`,
    body: `${terminal} still runs, without a pane. Click to bring it back in a tab of its own.`,
    level: "error",
    action: { name: "terminal.keep", args: { terminal } },
  });
}

// One move at a time per terminal, across every header: a second click during the second a
// park takes, or a drop that fires twice, could park it again after the first move's keep.
const moving = new Set();
function once(move) {
  return async (cx, terminal, ...rest) => {
    if (moving.has(terminal)) return;
    moving.add(terminal);
    try { await move(cx, terminal, ...rest); } finally { moving.delete(terminal); }
  };
}

// Moves a terminal beside a pane: it comes back right of or under the target
// (terminal.keep, beside the focused pane), swapped to the left or top when asked.
const dock = once(async (cx, terminal, target, side) => {
  if (!(await lift(cx, terminal))) return rescue(cx, terminal, "dock");
  run("pane.focus", { pane: target });
  run("terminal.keep", { terminal, place: side === "left" || side === "right" ? "right" : "down" });
  if (!(await until(cx, () => placed(terminal), 5000))) return rescue(cx, terminal, "dock");
  const moved = paneOf(terminal);
  if (side === "left" || side === "top") run("pane.swap", { pane: moved, target });
  run("pane.focus", { pane: moved });
});

// Puts a docked terminal back in a tab of its own (terminal.keep without a place: a new
// tab: its thumbnail at the top, its card in the agents list), and stays on the tab it
// left: `stay`, a pane that was beside it, keeps the focus.
const undock = once(async (cx, terminal, stay) => {
  if (!(await lift(cx, terminal))) return rescue(cx, terminal, "undock");
  run("terminal.keep", { terminal });
  if (!(await until(cx, () => placed(terminal), 5000))) return rescue(cx, terminal, "undock");
  run("pane.focus", { pane: stay });
});

// An undock parks the pane whose header was clicked, and a header goes with its pane, its
// tasks too: a move run there stops before its keep, and the terminal is left without a
// pane. So the clicked header only asks (shared "yozakura.dock.undock": [{ terminal, stay, at }]) and
// the header of `stay`, a pane that stays, runs the move. (A dock runs in the header it was
// dropped on, which stays too.) A request not taken within 3 s is dropped: nothing moved yet.
const UNDOCKS = "yozakura.dock.undock";
const fresh = (queue, now) => (Array.isArray(queue) ? queue : []).filter((r) => now - r.at < 3000);
function askUndock(terminal, stay) {
  const now = Date.now();
  setShared(UNDOCKS, [...fresh(shared(UNDOCKS), now).filter((r) => r.terminal !== terminal), { terminal, stay, at: now }]);
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    // Takes the undocks asked of this pane's header (see askUndock). A timer, as it keeps
    // running while this pane is hidden (behind a zoomed one): a light read, no redraw.
    cx.timer.every(100, (cx) => this.takeUndocks(cx));
  }

  takeUndocks(cx) {
    const queue = shared(UNDOCKS);
    if (!Array.isArray(queue) || !queue.length) return;
    const now = Date.now(), mine = props()?.pane;
    const left = fresh(queue, now).filter((r) => r.stay !== mine);
    const taken = fresh(queue, now).filter((r) => r.stay === mine);
    if (left.length !== queue.length) setShared(UNDOCKS, left.length ? left : null);
    for (const r of taken) cx.spawn(async (cx) => undock(cx, r.terminal, r.stay));
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/yozakura-pane/${icon}.svg`).size(14));
  }

  // The header while a terminal is dragged: four drop zones over its whole width. The
  // drag is read here, at render: a press on a zone still has it after another header's
  // press-outside cleared the shared one.
  zones(t, pane, drag) {
    const drop = (side, cx) => {
      setShared("yozakura.dock.drag", null);
      cx.spawn(async (cx) => dock(cx, drag.terminal, pane, side));
    };
    return h_flex()
      .id(`dock-${pane}`)
      .size_full()
      .px(6)
      .gap(4)
      .items_center()
      .rounded_t(13).bg(mainFill(t.background))
      .border_b(1)
      .border_color(t.accent)
      .on_mouse_up("left", () => setShared("yozakura.dock.drag", null))
      .on_mouse_down_out(() => { if (shared("yozakura.dock.drag")) setShared("yozakura.dock.drag", null); })
      .children(SIDES.map((s) => h_flex()
        .id(`dock-${pane}-${s.id}`)
        .flex_1()
        .min_w(0)
        .h(22)
        .items_center()
        .justify_center()
        .rounded(6)
        .bg(t.accent + "1a")
        .text_size(11.5)
        .text_color(t.accent)
        .hover((el) => el.bg(t.accent + "4d").text_color(t.foreground))
        // Pressed on: the zones stayed up after a release elsewhere.
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); drop(s.id, cx); })
        // Let go on: the drag ends here (unless that press already docked).
        .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); if (shared("yozakura.dock.drag")) drop(s.id, cx); })
        .child(div().truncate().child(s.text))));
  }

  render(cx) {
    const t = theme();
    const all = panes();
    const p = all.find((q) => q.pane === props()?.pane);
    if (!p) return div();
    const drag = shared("yozakura.dock.drag");
    if (drag?.terminal && drag.terminal !== p.terminal) return this.zones(t, p.pane, drag);
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    // Docked: other panes share its tab. Undocking leaves the focus there, on the focused one.
    const others = all.filter((q) => q.tab === p.tab && q.pane !== pane);
    const stay = (others.find((q) => q.focused) ?? others[0])?.pane;
    // The focused panel's bar stands out: tinted with the accent, an accent line under it.
    const on = p.focused;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .rounded_t(13).bg(mainFill(on ? mix(t.background, t.accent, 0.32) : t.background)) // sits inside a 14px card
      .border_b(1)
      .border_color(on ? t.accent : t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().when(on, (el) => el.font_semibold()).text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(Boolean(st), el => el.child(status(t, st, Boolean((shared("yozakura.background") ?? {})[p.terminal]))))
      // Always there on a docked terminal: back to a tab of its own.
      .when(Boolean(stay) && Boolean(p.terminal), el => el.child(div()
        .id(`ph-u-${pane}`)
        .p(3)
        .rounded(4)
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Undock: back to its own tab")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          askUndock(p.terminal, stay);
        })
        .child(svg("mods/yozakura-pane/undock.svg").size(14))))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
