// Yozakura: adapted from Herdr's shipped "tabs" mod (Apache License 2.0), changed for this layout.
// See THIRD_PARTY_NOTICES.md in the yozakura repository.
// The bar on top: one thumbnail per desktop (a Herdr tab: the panels docked together; a lone
// panel is a desktop of its own), then the actions card on the right; under them, when the
// shown desktop has several panels, one thumbnail per panel.
// A click on another desktop shows it; a click on the shown one opens, under its thumbnail,
// its name to edit (see list()). Double-click: Herdr's rename dialog.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, closeOverlay, props, theme, window, shared, setShared, layout, settings } from "herdr";

// The cards' fill at the opacity in yozakura-chrome/settings.json (1 when unset).
const islandFill = (c) => {
  const o = shared("yozakura.opacity");
  if (typeof o !== "number" || o >= 1 || !/^#[0-9a-f]{6}$/i.test(c)) return c;
  return c + Math.round(Math.max(0, o) * 255).toString(16).padStart(2, "0");
};

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// A pane's activity, as in yozakura-agents: working spins, blocked (waiting for you)
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

function programIcon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).size(size).flex_none();
}

// The session's title, as on the agent cards (yozakura-agents): what the program calls it
// (its terminal title, Claude's session name) without the status glyph in front; not a
// folder, a user@host or the program's own name. Null: none worth showing.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// An agent's title comes from agents(): a pane's own title can be its program's name.
function sessionTitle(p, agentTitle) {
  const live = clean(agentTitle ?? p?.title);
  const telling = live && live !== p.program?.name && live.toLowerCase() !== p.program?.key && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@");
  return telling ? live : null;
}

// What a panel is called: its session's title, else its program (a mod pane: its title).
function panelName(p, titles) {
  if (!p.terminal) return p.title || p.program?.name || "Panel";
  return sessionTitle(p, titles.get(p.pane)) ?? p.program?.name ?? "Terminal";
}

// A desktop's name, when someone gave it one. A tab Herdr made for a terminal (an undock,
// terminal.keep) is named after its program or its address: that isn't a name.
function desktopName(c, ps) {
  if (!c?.named || /^tb\d+$/.test(c.name)) return null;
  return ps.some((p) => c.name === p.program?.name || c.name === p.terminal || c.name === p.title) ? null : c.name;
}
// Unnamed, a desktop goes by its first panel.
const desktopLabel = (c, ps, titles) => desktopName(c, ps) ?? (ps[0] ? panelName(ps[0], titles) : c.name);

// When a desktop's name field last closed. A press on the shown desktop's thumbnail while
// its field is open closes it (a press beside a popup), and the release that follows must not
// open it again: the thumbnail toggles it. Shared by the bar and the field, two copies of this mod.
let listClosed = { desktop: null, at: 0 };
// The bar's rows: the desktops, then (the shown desktop having several panels) its panels.
const ROW = 38, STRIP = 30, STRIP_GAP = 6;

export default class Tabs extends View {
  init(_props, cx) {
    if (props()?.desktop) return this.initList(cx);
    this.pressed = null; // the desktop thumbnail pressed (its tab id), to reorder on release
    this.pressedPane = null; // the panel thumbnail pressed (its pane), to swap on release
    this.press = null; // { key, x, y, started }: a press on a thumbnail that may become a dock drag
    this.asked = null; // the bar height last asked for (layout.resize), until the layout has it
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // A press on a thumbnail that moves 6px, or leaves it, drags it: a panel's terminal docks
  // beside another pane (yozakura-pane draws the zones); a whole desktop (`desktop`) goes to a
  // space in the sidebar (yozakura-spaces); a one-panel desktop is that panel, so it docks too.
  // Letting go on another thumbnail of the same space still reorders.
  startDock(terminal, tab, desktop = false) {
    this.press.started = true;
    if (terminal || desktop) setShared("yozakura.dock.drag", { terminal, tab, desktop });
  }

  // A desktop or panel brought from another space (shown by resting on it in the sidebar) and
  // let go on this bar: yozakura-spaces moves it into the space shown.
  dropHere(drag, space) {
    if (!drag || !space || space.tabs.some((tab) => tab.id === drag.tab)) return false;
    setShared("yozakura.desk.drop", { drag, space: space.id });
    run("yozakura-spaces.drop");
    return true;
  }

  // The press is over; true when it was dragging a terminal.
  endDock() {
    this.press = null;
    if (!shared("yozakura.dock.drag")) return false;
    setShared("yozakura.dock.drag", null);
    return true;
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // The shown desktop's name field, under its thumbnail (`bounds`: the thumbnail's, in the window).
  openList(c, bounds) {
    if (listClosed.desktop === c.id && Date.now() - listClosed.at < 400) return; // this press closed it
    openOverlay({
      mod: "yozakura-tabs",
      kind: "popup",
      width: 300,
      height: 50, // padding, the field, and Herdr's frame
      at: bounds ? { x: bounds.x, y: bounds.y + bounds.height + 6 } : "pointer",
      props: { desktop: c.id },
    });
  }

  // ---- The name field: a desktop's name, typed in place (props: { desktop, overlay }). ----

  initList(cx) {
    this.desktop = props().desktop;
    const c = spaces().flatMap((s) => s.tabs).find((x) => x.id === this.desktop);
    const ps = panes().filter((p) => p.tab === this.desktop);
    const titles = new Map(agents().map((a) => [a.pane, a.title]));
    this.name = desktopName(c, ps) ?? "";
    this.input = InputState.new({ value: this.name, placeholder: ps[0] ? panelName(ps[0], titles) : "Desktop name" });
    // Opened to be typed in: the keyboard goes to the field, its name selected to be replaced.
    if (this.name) this.input.set_selected_range({ start: 0, end: this.name.length });
    this.inputFocused = true;
    this.input.on("submit", () => this.rename(true));
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; this.rename(false); cx.notify(); });
    this.input.focus();
    cx.timer.after(150, () => this.input.focus()); // once the popup is up, as the prompt mod does
    this.handle = cx.focus_handle();
  }

  // Enter, or leaving the field, names the desktop; an empty name gives it back its default.
  rename(close) {
    const name = this.input.value().trim();
    if (name !== this.name) {
      this.name = name;
      run("tab.rename", { id: this.desktop, name });
    }
    if (close) closeOverlay(props().overlay);
  }

  async close() {
    if (this.desktop) listClosed = { desktop: this.desktop, at: Date.now() };
  }

  list() {
    const t = theme();
    const overlay = props().overlay;
    return h_flex()
      .id("desk-name")
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(overlay); cx.stop_propagation(); } })
      .size_full()
      .p(6)
      .px(14)
      .gap(8)
      .items_center()
      .bg(t.popover)
      .text_size(12.5)
      .text_color(t.foreground)
      // Typed in place: Enter, or leaving the field, keeps it; empty, the desktop goes by its first panel.
      .child(svg("mods/yozakura-chrome/square-pen.svg").size(13).flex_none().text_color(t.dim))
      .child(Input.new(this.input).flex_1().h(28).px(8).rounded(7).border_1()
        .border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground));
  }

  render() {
    if (this.desktop) return this.list();
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const drag = shared("yozakura.dock.drag");
    const tabPanes = new Map();
    for (const p of panes()) tabPanes.set(p.tab, [...(tabPanes.get(p.tab) ?? []), p]);
    const titles = new Map(agents().map(a => [a.pane, a.title]));
    const background = shared("yozakura.background") ?? {}; // terminal -> its background commands
    // With shoji (shared "yozakura.shoji", see yozakura-chrome): paper plaques in a wooden frame.
    const kit = shared("yozakura.shoji");
    const plaque = (el, on, round) => kit
      ? el.rounded(4).border(2).border_color(on ? t.accent : kit.frame).bg(t.background)
      : el.rounded(round).border(1).border_color(on ? t.accent : t.border);
    const button = (id, label, action, pill = false) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .when(pill, el => el.bg(t.surface).border(1).border_color(t.border)) // neutral pill, like a tab
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    // One thumbnail per desktop: a screen, its name, how many panels when several, its most
    // urgent status. The shown one is outlined in the accent.
    const desktop = (c, i) => {
      const ps = tabPanes.get(c.id) ?? [];
      const lone = ps.length <= 1;
      const terminal = lone ? ps[0]?.terminal ?? null : null;
      const name = desktopLabel(c, ps, titles);
      const on = c.active;
      return h_flex().id(`desk-${c.id}`).h_full().px(14).gap(7).items_center().flex_none().text_size(12)
        .when(!kit, el => el.bg(islandFill(t.surface)))
        .when(true, el => plaque(el, on, 14)) // as tall and round as the Herdr card
        .text_color(on ? t.accent : t.muted)
        .hover(s => s.bg(t.hover))
        .when(drag?.tab === c.id && (drag.desktop || drag.terminal === terminal), el => el.opacity(0.5)) // being dragged
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation(); this.pressed = c.id;
          this.press = { key: c.id, x: e.position.x, y: e.position.y, started: false };
          if (e.click_count === 2) run("tab.rename", { id: c.id });
        })
        .on_mouse_move(e => {
          const s = this.press;
          if (s?.key === c.id && !s.started && Math.hypot(e.position.x - s.x, e.position.y - s.y) > 6) this.startDock(terminal, c.id, true);
        })
        .on_hover(over => { if (!over && this.press?.key === c.id && !this.press.started) this.startDock(terminal, c.id, true); })
        .on_mouse_up("left", (e) => {
          const from = this.pressed; this.pressed = null;
          const drag = shared("yozakura.dock.drag");
          const docking = this.endDock();
          // The pressed desktop may belong to another space: resting on a space shows it mid-drag.
          const reorder = from !== null && from !== c.id && shown.some(x => x.id === from);
          if (reorder) run("tab.move", { id: from, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else if (docking && this.dropHere(drag, space)) return;
          else if (!docking || from === c.id) { // not a drag from elsewhere ending here
            if (!on) run("tab.select", { id: c.id });
            else if (e.click_count < 2) this.openList(c, e.bounds);
          }
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        // A screen: whole for a lone panel, split for several (the panels have their programs' icons).
        .child(svg(`mods/yozakura-tabs/${lone ? "desktop" : "desktop-split"}.svg`).size(14).flex_none().text_color(on ? t.accent : t.muted))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(!lone, el => el.child(div().h(16).min_w(16).px(4).flex_none().flex().items_center().justify_center()
          .rounded(8).bg(t.raised).text_size(10.5).text_color(on ? t.accent : t.dim).child(String(ps.length))))
        .when(Boolean(c.status), el => el.child(status(t, c.status, ps.some(q => background[q.terminal]))))
        // Closing a lone panel's desktop ends one terminal; a desktop of several closes panel by panel.
        .when(on && lone, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
          .child(svg("mods/yozakura-pane/close.svg").size(12))));
    };
    // The shown desktop's panels, under the desktops when it has several: one thumbnail each,
    // the focused one outlined in the accent. Click: focus it. Drag: dock it elsewhere (the
    // panes' zones, yozakura-pane), or let go on another panel's thumbnail to swap their places.
    const active = shown.find(c => c.active);
    const activePanes = active ? tabPanes.get(active.id) ?? [] : [];
    const strip = activePanes.length > 1;
    const panelThumb = (p) => {
      const on = p.focused;
      const name = panelName(p, titles);
      return h_flex().id(`pthumb-${p.pane}`).h_full().px(12).gap(7).items_center().flex_none().text_size(12)
        .when(!kit, el => el.bg(on ? t.selected : islandFill(t.surface)))
        .when(true, el => plaque(el, on, STRIP / 2))
        .text_color(on ? t.accent : t.muted)
        .hover(s => s.bg(t.hover))
        .when(Boolean(p.terminal) && drag?.terminal === p.terminal, el => el.opacity(0.5)) // being dragged
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation(); this.pressedPane = p.pane;
          this.press = { key: p.pane, x: e.position.x, y: e.position.y, started: false };
        })
        .on_mouse_move(e => {
          const s = this.press;
          if (s?.key === p.pane && !s.started && Math.hypot(e.position.x - s.x, e.position.y - s.y) > 6) this.startDock(p.terminal, active.id);
        })
        .on_hover(over => { if (!over && this.press?.key === p.pane && !this.press.started) this.startDock(p.terminal, active.id); })
        .on_mouse_up("left", () => {
          const from = this.pressedPane; this.pressedPane = null;
          const docking = this.endDock();
          if (from && from !== p.pane && activePanes.some(q => q.pane === from)) run("pane.swap", { pane: from, target: p.pane });
          else if (!docking || from === p.pane) run("pane.focus", { pane: p.pane });
        })
        .when(Boolean(p.program?.icon), el => el.child(programIcon(p.program, 14, on ? t.accent : t.muted)))
        .child(div().max_w(170).truncate().child(p.zoomed ? `${name} Z` : name))
        .when(Boolean(p.status), el => el.child(status(t, p.status, Boolean(background[p.terminal]))))
        .when(on, el => el.child(div().id(`pclose-${p.pane}`).text_color(t.dim).on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); run("pane.close", { pane: p.pane }); })
          .child(svg("mods/yozakura-pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // The bar's block grows to show the panels' row, and shrinks back without it.
    const bar = find(root, "tabs"), want = strip ? ROW + STRIP_GAP + STRIP : ROW;
    if (typeof bar?.size?.px === "number") {
      if (bar.size.px === want) this.asked = null;
      else if (this.asked !== want) { this.asked = want; run("layout.resize", { id: "tabs", px: want }); }
    }
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 0; // tabs line up with the main panel's left edge
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "commits"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).border(1).border_color(on ? t.accent : "#00000000").text_color(on ? t.accent : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    const desktops = h_flex().id("desktops").h(ROW).flex_none().w_full().min_w(0).pl(lightsPadding).gap(3).items_center()
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(desktop)))
      // The buttons on the right share one card, like the sidebar's, flush with the main panel's right edge.
      .child(h_flex().id("tab-actions").flex_none().h_full().px(10).gap(2).items_center()
        .when(!kit, el => el.rounded(14).bg(islandFill(t.chrome)).border(1).border_color(t.border))
        .when(Boolean(kit), el => el.rounded(4).border(4).border_color(kit.frame).bg(t.background))
        .child(button("tab-new", "+", () => openOverlay({ mod: "yozakura-new-menu", kind: "popup", width: 250, height: 512 })))
        .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/yozakura-tabs/file.svg")))
        .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/yozakura-tabs/changes.svg")))
        .child(panelButton("commits", "Commits", "mods/yozakura-tabs/commit.svg"))
        .when(w?.buttons, el => el.child(div().w(1).h(16).mx(3).flex_none().bg(t.border))
          .child(button("minimize", w.platform === "windows" ? svg("mods/yozakura-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
          .child(button("maximize", w.platform === "windows" ? svg(`mods/yozakura-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
          .child(button("close-window", w.platform === "windows" ? svg("mods/yozakura-tabs/win-close.svg").size(16) : svg("mods/yozakura-pane/close.svg").size(13), () => run("window.close")))));
    return v_flex().size_full().min_w(0).gap(STRIP_GAP) // no fill: the canvas shows through
      .on_mouse_up("left", () => {
        this.pressed = null; this.pressedPane = null;
        const drag = shared("yozakura.dock.drag");
        if (this.endDock()) this.dropHere(drag, space);
      })
      .child(desktops)
      .when(strip, el => el.child(h_flex().id("pane-strip").h(STRIP).flex_none().w_full().min_w(0).gap(3).items_center()
        .overflow_x_scrollbar().children(activePanes.map(panelThumb))));
  }
}
