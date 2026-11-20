// Yozakura: adapted from Herdr's shipped "agents" mod (Apache License 2.0), changed for this layout.
// See THIRD_PARTY_NOTICES.md in the yozakura repository.
// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, spaces, terminals, panes, focused, home, run, notify, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, hc } from "herdr";

// How long a terminal may be without a tab before it's brought back (see recover()).
const LOST_GRACE = 10000;

// The wood of a shoji rail, `h` px tall (see yozakura-chrome): its texture's strips side by
// side, as wide as any card, and a line under it.
function rail(kit, h) {
  return [
    h_flex().absolute().top(0).left(0).h_full().children([0, 1].map(() => image(kit.wood).w(Math.round((h * 4000) / 60)).h(h).flex_none())),
    div().absolute().bottom(0).left(0).w_full().h(1).bg(kit.edge),
  ];
}

// A corner's radius: nearly square with the shoji look (shared "yozakura.shoji").
const corner = (r) => (shared("yozakura.shoji") ? 3 : r);

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

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 100;

// The session's title: what the agent calls it (its terminal title, Claude's session name),
// without the status glyph in front; not a folder, a user@host or the program's own name.
// Else a tab someone named; else none.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
function sessionTitle(a) {
  const live = clean(a.title);
  const telling = live && live !== a.program?.name && live.toLowerCase() !== a.program?.key && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@");
  if (telling) return live;
  return a.tab_name && !/^(tb)?\d+$/.test(a.tab_name) ? a.tab_name : null;
}

// A desktop's name as its thumbnail at the top shows it (yozakura-tabs): the name someone gave
// it, else its first panel's (its session's title, else its program; a mod pane: its title).
// A name Herdr gave a tab it made for a terminal (its program, its address) isn't a name.
function desktopLabel(tab, ps, titles) {
  const given = tab.named && !/^tb\d+$/.test(tab.name)
    && !ps.some((p) => tab.name === p.program?.name || tab.name === p.terminal || tab.name === p.title);
  if (given) return tab.name;
  const p = ps[0];
  if (!p) return tab.name;
  if (!p.terminal) return p.title || p.program?.name || "Panel";
  const live = clean(titles.get(p.pane) ?? p.title);
  const telling = live && live !== p.program?.name && live.toLowerCase() !== p.program?.key && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@");
  return telling ? live : p.program?.name ?? "Terminal";
}

// The status line's thresholds and its ANSI colors: green under 50%, yellow to 79%, red from 80%.
const level = (t, p) => (p >= 80 ? t.ansi1 : p >= 50 ? t.ansi3 : t.ansi2);
const GAUGE = 40;
function gauge(t, p) {
  const fill = Math.round((GAUGE * Math.min(100, Math.max(0, p))) / 100);
  return div().w(GAUGE).h(6).flex_none().rounded(2).overflow_hidden().bg(t.input)
    .child(div().h_full().w(fill).bg(level(t, p)));
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
// The first is the default: grouped by desktop, in the order of the thumbnails at the top.
const SORTS = [
  { id: "desktop", label: "Grouped by desktop", icon: "monitor" },
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("yozakura.agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
// A status light rather than the theme's idle grey, readable on dark and light.

// While an agent works, a small dancer plays in its card's top right corner (an animated GIF:
// GPUI plays it by itself, no timer). Each agent keeps its own, picked by its number, so
// agents started one after another get different ones. Each GIF is cropped to its figure over
// all its frames, and shown 40 px high at its own width (the crop's), so every dancer fills
// its box whatever its shape: [name, width].
const DANCERS = [["godzilla", 40], ["cat", 37], ["maiko", 34], ["teddy", 39], ["samurai", 34], ["salaryman", 35], ["kabuki", 36], ["panda", 39]];
const DANCER_HEIGHT = 40;
function dancer(a) {
  let n = Number.isInteger(a.seq) ? a.seq : 0;
  if (!Number.isInteger(a.seq)) for (const ch of a.address) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const [name, width] = DANCERS[n % DANCERS.length];
  return image(`mods/yozakura-agents/dancers/${name}.gif`).w(width).h(DANCER_HEIGHT);
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // The list's scroll, to bring the focused agent's card into view (see render).
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    this.press = null; // { address, x, y, started }: a press on a card that may become a dock drag
    this.lost = new Map(); // address -> when it was first seen lost, or when to try again (ms)
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(4000, (cx) => this.recover(cx));
    this.background = new Map(); // address -> how many commands run in its background
    // What a previous run shared is stale until the first scan.
    if (Object.keys(shared("yozakura.background") ?? {}).length) setShared("yozakura.background", {});
    cx.timer.every(3000, (cx) => this.scan(cx));
  }

  // Claude Code's background commands (run_in_background, a command sent to the background,
  // a monitor): each runs in a shell of its own under the agent's claude process, recognizable
  // by the shell snapshot it sources. A foreground command looks the same, but it never
  // outlives the agent's turn: a shell alive while the agent isn't working, or started before
  // its current turn, is in the background. One started during the turn counts once the turn
  // ends. Background sub-agents run inside claude and aren't seen.
  scan(cx) {
    if (this.scanning) return;
    const claude = agents().filter((a) => a.program?.key === "claude" && !a.address.includes("/"));
    if (!claude.length) {
      if (this.background.size) { this.background = new Map(); setShared("yozakura.background", {}); cx.notify(); }
      return;
    }
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        const [ps, ...found] = await Promise.all([
          exec("sh", ["-c", "ps -axo pid=,ppid=,etime=,args= | awk '/[s]hell-snapshots/ {print $1, $2, $3}'"]),
          ...claude.map((a) => hc(["get", a.address]).catch(() => null)),
        ]);
        // etime: [[dd-]hh:]mm:ss
        const age = (s) => {
          const [d, rest] = s.includes("-") ? s.split("-") : ["0", s];
          return rest.split(":").map(Number).reduce((sum, v) => sum * 60 + v, 0) + Number(d) * 86400;
        };
        const shells = ps.stdout.trim().split("\n").filter(Boolean).map((line) => {
          const [, ppid, etime] = line.trim().split(/\s+/);
          return { ppid: Number(ppid), age: age(etime) };
        });
        const now = Date.now();
        const next = new Map();
        claude.forEach((a, i) => {
          let pid = null;
          try { pid = JSON.parse(found[i]?.stdout ?? "null")?.foreground?.pid ?? null; } catch {}
          if (!pid) return;
          const turn = a.status === "working" ? this.since(a) - 3000 : Infinity;
          const n = shells.filter((s) => s.ppid === pid && now - s.age * 1000 < turn).length;
          if (n) next.set(a.address, n);
        });
        const same = next.size === this.background.size && [...next].every(([k, v]) => this.background.get(k) === v);
        // Shared with yozakura-tabs and yozakura-pane, whose status icons show it too.
        if (!same) { this.background = next; setShared("yozakura.background", Object.fromEntries(next)); cx.notify(); }
      }
      catch {}
      finally { this.scanning = false; }
    });
  }

  // A terminal Herdr showed (its `where` label) that has no tab anymore: no space or tab
  // label, no core keep, no pane, and no parent (a parked sub-agent shows under its parent).
  // Nothing in this layout parks one on purpose: an yozakura-pane move parks it for a moment
  // and gives it a pane again, and the menu's "Send back" is for sub-agents only. Should a
  // move still lose it, it would run on in no list: it comes back in a tab of its own (its
  // thumbnail at the top, its card here), without taking the focus; the toast goes to it.
  // Local ones only: the new tab opens in the shown space.
  recover(cx) {
    const now = Date.now();
    const paned = new Set(panes().map((p) => p.terminal));
    const lost = terminals().filter((k) => k.state === "live" && !k.parent && !k.address.includes("/")
      && k.labels?.where && !k.labels["herdr.space"] && !k.labels["herdr.tab"] && k.keep !== true && !paned.has(k.address));
    const listed = new Set(lost.map((k) => k.address));
    for (const address of [...this.lost.keys()]) if (!listed.has(address)) this.lost.delete(address);
    for (const k of lost) {
      const terminal = k.address;
      const at = this.lost.get(terminal);
      // A move takes a second or so between its park and its keep: leave it that time.
      if (at === undefined) { this.lost.set(terminal, now); continue; }
      if (now - at < LOST_GRACE) continue;
      this.lost.set(terminal, now + 30000); // not back by then: try again
      const back = focused()?.pane;
      run("terminal.keep", { terminal });
      cx.spawn(async (cx) => {
        for (let i = 0; i < 100 && !panes().some((p) => p.terminal === terminal); i++) await cx.sleep(50);
        if (back && focused()?.pane !== back) run("pane.focus", { pane: back });
      });
      const name = clean(k.title) || k.program?.name || terminal;
      notify({
        title: "Terminal brought back",
        body: `${name} (${terminal}) had lost its pane: it's back in a tab of its own.`,
        level: "info",
        action: { name: "pane.focus", args: { terminal } },
      });
    }
  }

  // A press on a card that moves 6px, or leaves the card, drags the agent's terminal to
  // dock it beside a pane (yozakura-pane draws the zones on the pane headers).
  startDock(a) {
    this.press.started = true;
    setShared("yozakura.dock.drag", { terminal: a.address, tab: a.tab });
  }

  // The press is over: a drag that didn't end on a zone ends here.
  endDock() {
    this.press = null;
    if (shared("yozakura.dock.drag")) setShared("yozakura.dock.drag", null);
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("yozakura.agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/yozakura-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/yozakura-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(corner(8))
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }));
  }

  // The activity on the right of a row, in a 14px slot so every row lines up:
  // working spins, blocked (waiting for you) warns, idle and done show a green dot; idle with
  // commands still running in its background, a green spinner: nothing to do, but busy.
  status(t, a) {
    const slot = h_flex().size(14).flex_none().items_center().justify_center();
    if (a.status === "working") return slot.child(svg("mods/yozakura-chrome/spinner.svg").size(12).text_color(t.working).spin(900));
    if (a.status === "blocked") return slot.child(svg("mods/yozakura-agents/warning.svg").size(14).text_color(t.blocked));
    if ((a.status === "idle" || a.status === "done") && this.background?.get(a.address))
      return slot.child(svg("mods/yozakura-chrome/spinner.svg").size(12).text_color(t.ansi2).spin(900));
    if (a.status === "idle" || a.status === "done") return slot.child(div().size(8).rounded(4).bg(t.ansi2));
    return slot;
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const drag = shared("yozakura.dock.drag");
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const byDesktop = sort.id === "desktop";
    // Each desktop (tab): its space's position, then its own, as the thumbnails at the top go.
    const spaceList = spaces();
    const desks = new Map();
    spaceList.forEach((sp, si) => sp.tabs.forEach((tab) => desks.set(tab.id, { order: si * 10000 + tab.index, tab, space: sp })));
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const deskOrder = (a) => desks.get(a.tab)?.order ?? Infinity;
    if (byDesktop) list = [...list].sort((x, y) => deskOrder(x) - deskOrder(y));
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/yozakura-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // Each agent's folder (its pane's live one) and Claude's figures (the `claude.*` labels
    // ~/.claude/statusline.sh writes on its terminal). Read once for every card: every
    // host read copies the whole list into JS.
    const cwds = new Map(panes().map(p => [p.pane, p.cwd]));
    const claude = new Map(all.filter(k => k.labels?.["claude.ctx_size"]).map(k => [k.address, k.labels]));
    const h = home();
    const folder = (cwd) => !cwd ? "" : cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;

    // A card per agent: its icon and space; its session's title; its folder, with how long
    // it has been in its state and that state on the right; then Claude's model and context
    // window, and the email of the account it runs on.
    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .w(34) // fixed width, centered by the list, so a wider rail doesn't stretch it
          .px(4)
          .rounded(6)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(this.status(t, a));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/yozakura-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      const c = claude.get(a.address);
      const n = (key) => Number(c?.[key] ?? 0);
      const named = sessionTitle(a);
      const dancing = a.status === "working";
      const background = this.background?.get(a.address) ?? 0;
      return v_flex()
        .id(`ag-${a.address}`)
        .relative() // the dancer's corner
        .flex_none()
        .my(3)
        .px(10)
        .py(8)
        .gap(4)
        .rounded(corner(10))
        .border(1)
        .border_color(a.focused ? t.accent : t.border) // the shown agent outlined, like the active tab
        .bg(a.focused ? t.selected : t.surface)
        .when(drag?.terminal === a.address, (el) => el.opacity(0.5)) // being dragged
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          if (!on && this.press?.address === a.address && !this.press.started) this.startDock(a);
          cx.notify();
        })
        .on_mouse_down("left", (e) => { this.press = { address: a.address, x: e.position.x, y: e.position.y, started: false }; })
        .on_mouse_move((e) => {
          const p = this.press;
          if (p?.address === a.address && !p.started && Math.hypot(e.position.x - p.x, e.position.y - p.y) > 6) this.startDock(a);
        })
        .on_mouse_up("left", () => this.endDock())
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(dancing, (el) => el.child(dancer(a).absolute().top(4).right(8)))
        // The agent and its space; the fold and, under the pointer, the pin (left of the dancer).
        .child(h_flex().h(18).gap(8).items_center().when(dancing, (el) => el.pr(42))
          .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
            .when(subs.length > 0, el => el.on_click((_e, cx) => {
              cx.stop_propagation();
              this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
              cx.notify();
            })).child(pic)))
          .child(div().flex_1().min_w(0).truncate().font_medium().text_color(idle ? t.muted : t.foreground).child(a.space_name || a.program?.name || a.address))
          .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
          .when(subs.length > 0, el => el.child(fold(a, subs)))
          .when(this.hovered === a.address, el => el.child(pin)))
        // The session's title, behind a speech bubble.
        .when(Boolean(named), el => el.child(h_flex().h(16).gap(6).items_center().text_size(11.5).when(dancing, (el) => el.pr(42))
          .child(svg("mods/yozakura-agents/bubble.svg").size(12).flex_none().text_color(t.ansi6))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(named))))
        // Its folder (the status bar's icon), cut at the start so its own name stays; how long
        // in this state, and the state.
        .child(h_flex().h(16).gap(6).items_center().text_size(11.5).when(dancing && !named, (el) => el.pr(42)) // under the dancer when second
          .child(svg("mods/yozakura-chrome/folder.svg").size(12).flex_none().text_color(t.ansi4))
          .child(div().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_color(t.dim).child(folder(cwds.get(a.pane))))
          // Commands still running in its background (see scan), and how many.
          .when(background > 0, el => el.child(h_flex().id(`bg-${a.address}`).flex_none().gap(3).items_center().text_size(11).text_color(t.working)
            .tooltip(background === 1 ? "1 background task" : `${background} background tasks`)
            .child(svg("mods/yozakura-agents/background.svg").size(12))
            .child(String(background))))
          .when(Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
          .child(this.status(t, a)))
        // Claude's model and context window, as in the status bar.
        .when(Boolean(c), el => el.child(h_flex().h(16).gap(6).items_center().text_size(11)
          .child(div().min_w(0).truncate().text_color(t.muted).child(c["claude.model"] ?? ""))
          .child(gauge(t, n("claude.ctx_pct")))
          .child(div().flex_none().text_color(t.dim).child(`(${Math.floor(n("claude.ctx_used") / 1000)}k/${Math.floor(n("claude.ctx_size") / 1000)}k)`))
          .child(div().flex_none().text_color(level(t, n("claude.ctx_pct"))).child(`${n("claude.ctx_pct")}%`))))
        // The account it runs on: its email (`claude.email`), when the status line knows it.
        .when(Boolean(c?.["claude.email"]), el => el.child(h_flex().h(16).gap(6).items_center().text_size(11)
          .child(svg("mods/yozakura-agents/account.svg").size(12).flex_none().text_color(t.ansi5))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(c["claude.email"]))));
    };

    // Groups in list order: desktops, spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), and the desktop sort puts each desktop's
    // together, so neighbours make a group. A desktop's header has its thumbnail's name and
    // screen; its space too when there are several.
    const tabPanes = new Map();
    if (byDesktop) for (const p of panes()) tabPanes.set(p.tab, [...(tabPanes.get(p.tab) ?? []), p]);
    const titles = new Map(list.map((a) => [a.pane, a.title]));
    const desktopGroup = (a) => {
      const d = desks.get(a.tab);
      if (!d) return { label: a.tab_name || a.space_name || "", icon: null, sub: null };
      const ps = tabPanes.get(a.tab) ?? [];
      return {
        label: desktopLabel(d.tab, ps, titles),
        icon: `mods/yozakura-tabs/${ps.length > 1 ? "desktop-split" : "desktop"}.svg`,
        sub: spaceList.length > 1 ? d.space.name : null,
      };
    };
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : byDesktop ? `dt-${a.tab}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else if (byDesktop) groups.push({ id, ...desktopGroup(a), status: null, members: [a] });
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .when(Boolean(g.icon), (el) => el.child(svg(g.icon).size(12).flex_none().text_color(t.dim)))
        .child(div().min_w(0).truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(Boolean(g.sub), (el) => el.child(div().flex_none().text_color(t.dim).opacity(0.7).child(g.sub)))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top })))
          .child(svg("mods/yozakura-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    // The rows, and which holds the focused agent's card (its group's header when folded).
    const focusedAgent = list.find((a) => a.focused)?.address ?? null;
    const rows = [];
    let at = -1, where = "";
    const add = (els, mine, group) => {
      if (mine && at < 0) { at = rows.length; where = group; }
      rows.push(...els);
    };
    if (collapsed) list.forEach((a, i) => add(withKids(a, i), a.address === focusedAgent, "rail"));
    else for (const g of groups) {
      const folded = this.folded.has(g.id);
      add([header(g)], folded && g.members.some((a) => a.address === focusedAgent), g.id);
      if (!folded) g.members.forEach((a, i) => add(withKids(a, i), a.address === focusedAgent, g.id));
    }
    // Scrolled into view when another agent is focused, or its card moves to another
    // section; scrolling away from it otherwise stays.
    const reveal = focusedAgent && `${focusedAgent} ${where}`;
    if (reveal !== this.revealed && (at >= 0 || !focusedAgent)) {
      this.revealed = reveal;
      if (at >= 0) this.scroll.scroll_to_item(at);
    }

    // With shoji (shared "yozakura.shoji", see yozakura-chrome) the layout gives the card its
    // paper and frame, and the header is a rail of wood.
    const kit = shared("yozakura.shoji");
    return v_flex()
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .when(!kit, (el) => el.rounded(13).bg(islandFill(t.chrome))) // its own card now, so no top divider
      .text_size(13)
      .when(collapsed && !kit, (el) => el.pt(10))
      // Folded, the card keeps its rail, bare, like the Spaces card above it.
      .when(collapsed && Boolean(kit), (el) => el.child(h_flex().h(31).mb(6).flex_none().relative().children(rail(kit, 31))))
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .when(!kit, (el) => el.h(41).pt(14).pb(5))
            .when(Boolean(kit), (el) => el.h(31).mb(6).relative().children(rail(kit, 31)))
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(kit ? kit.ink : t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(kit ? kit.inkDim : t.dim)
                .hover((s) => s.text_color(kit ? kit.ink : t.foreground))
                .on_click(() => openOverlay({ mod: "yozakura-agents", kind: "popup", width: 210, height: 172, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/yozakura-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).when(collapsed, (el) => el.items_center()).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        .on_mouse_up("left", () => this.endDock()) // a drag let go over the list ends
        .children(rows));
  }
}
