// Yozakura: one commit in detail, in a panel right of Commits (the layout's `commit` block,
// hidden until a commit is picked). yozakura-history shares the pick as "yozakura.commit"
// { hash, root, on } and shows the block; this mod reads the commit with `git show` and
// draws its subject, author, date, parents and message, the files it touches with their
// counts (a click scrolls the diff to that file), then its whole diff (one virtual list: only
// the rows on screen are drawn). A merge shows its changes against its first parent. Closed
// by its ×, by picking the commit again, or by itself when the side panel closes or shows
// something other than Commits.
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { exec, theme, settings, shared, setShared, layout, run, window } from "herdr";

// Its width: the header's ← and → widen and narrow it by STEP; its left edge drags (shared as
// "yozakura.commit.resize" { x, width } while it does, so Commits, which the pointer crosses
// going left, follows the drag too). Kept in the layout (`layout.resize`), MIN to MAX.
const STEP = 80, MIN = 320, MAX = 1100;
const width = () => find(layout(), "commit")?.size?.px ?? 560;
function resize(px) {
  const next = Math.round(Math.min(MAX, Math.max(MIN, px)));
  if (next !== width()) run("layout.resize", { id: "commit", px: next });
}
// While dragging: the edge follows the pointer (`x`, in window coordinates).
function follow(x) {
  const d = shared("yozakura.commit.resize");
  if (d) resize(d.width + (d.x - x));
}
// Whether the system says the left button is up (macOS, through osascript, as yozakura-tabs
// does): a release over a terminal reaches no mod, so a drag ends when this says so.
async function leftButtonUp() {
  if (window()?.platform !== "macos") return null;
  try {
    const answer = await exec("osascript", ["-l", "JavaScript", "-e", 'ObjC.import("AppKit"); $.NSEvent.pressedMouseButtons']);
    const buttons = Number(answer.stdout.trim());
    return Number.isInteger(buttons) ? (buttons & 1) === 0 : null;
  } catch { return null; }
}

function rail(kit, h) {
  return [
    h_flex().absolute().top(0).left(0).h_full().children([0, 1].map(() => image(kit.wood).w(Math.round((h * 4000) / 60)).h(h).flex_none())),
    div().absolute().bottom(0).left(0).w_full().h(1).bg(kit.edge),
  ];
}
const corner = (r) => (shared("yozakura.shoji") ? 3 : r);
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const MAX_LINES = 20000; // past this, the diff is cut (a note says so)

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// The diff's rows: a header per file, its hunks, each line numbered once (as in Changes).
function diffRows(lines) {
  const rows = [];
  let old = 0, next = 0;
  for (const line of lines) {
    const file = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (file) { rows.push({ kind: "f", path: file[2], text: file[1] === file[2] ? file[2] : `${file[1]} → ${file[2]}` }); continue; }
    if (/^(index |--- |\+\+\+ |similarity |rename |new file mode|deleted file mode|old mode|new mode)/.test(line)) {
      if (/^(new file|deleted file|rename from|Binary)/.test(line)) rows.push({ kind: "", text: line });
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) { old = +hunk[1]; next = +hunk[2]; rows.push({ kind: "@", text: line }); continue; }
    const kind = line[0];
    if (kind === "-") rows.push({ kind, number: old++, text: untab(line.slice(1)) || " " });
    else if (kind === "+") rows.push({ kind, number: next++, text: untab(line.slice(1)) || " " });
    else if (kind === " ") { old++; rows.push({ kind, number: next++, text: untab(line.slice(1)) || " " }); }
    else if (line) rows.push({ kind: "", text: line });
  }
  return rows;
}

function when(ts) {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default class CommitDetail extends View {
  init(_props, cx) {
    this.key = null; this.info = null; this.files = []; this.rows = []; this.width = 0; this.error = null; this.cut = false;
    this.starts = new Map(); this.current = null; // path -> its header row in the diff; the file clicked last
    this.scroll = VirtualListScrollHandle.new();
    if (shared("yozakura.commit.resize")) setShared("yozakura.commit.resize", null);
    // A drag let go where no mod hears it (a terminal): ended as soon as the button is up.
    cx.timer.every(150, (cx) => {
      if (!shared("yozakura.commit.resize") || this.asking) return;
      this.asking = true;
      cx.spawn(async () => {
        try { if (await leftButtonUp()) setShared("yozakura.commit.resize", null); }
        finally { this.asking = false; }
      });
    });
    // The side panel closed, or shows Files or Changes: this one goes too.
    cx.timer.every(500, () => {
      const root = layout();
      const panel = find(root, "panel"), body = find(root, "panel-body"), self = find(root, "commit");
      if (self && !self.hidden && (panel?.hidden || body?.active !== "commits")) this.close();
    });
  }

  close() {
    setShared("yozakura.commit", null);
    run("layout.hide", { id: "commit" });
  }

  load(pick, cx) {
    const key = JSON.stringify(pick ?? null);
    if (key === this.key) return;
    this.key = key; this.info = null; this.files = []; this.rows = []; this.error = null; this.cut = false;
    this.starts = new Map(); this.current = null;
    if (!pick?.hash) return;
    const { hash, root, on } = pick;
    cx.spawn(async (cx) => {
      try {
        const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const [meta, stat, patch] = await Promise.all([
          git(["show", "-s", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%p%x1f%s%x1f%b", hash]),
          git(["show", "--format=", "--numstat", "--diff-merges=first-parent", "-M", hash]),
          git(["show", "--format=", "--patch", "--diff-merges=first-parent", "-M", "--no-color", "--no-ext-diff", "--no-textconv", hash]),
        ]);
        if (this.key !== key) return;
        if (meta.code !== 0) { this.error = (meta.stderr || "Commit introuvable").trim().split("\n").pop(); return; }
        const [full, short, author, email, at, parents, subject, body] = meta.stdout.replace(/\n$/, "").split("\x1f");
        this.info = { full, short, author, email, at: Number(at), parents: parents ? parents.split(" ") : [], subject, body: (body ?? "").trim() };
        this.files = stat.stdout.split("\n").filter(Boolean).map((l) => {
          const [add, del, ...path] = l.split("\t");
          return { add: add === "-" ? null : Number(add), del: del === "-" ? null : Number(del), path: path.join("\t").replace(/\{(.*) => (.*)\}/, "$2").replace(/^.* => /, "") };
        });
        let lines = patch.stdout.split("\n");
        if (lines.length > MAX_LINES) { lines = lines.slice(0, MAX_LINES); this.cut = true; }
        this.rows = diffRows(lines);
        this.rows.forEach((r, n) => { if (r.kind === "f") this.starts.set(r.path, n); });
        this.scroll.scroll_to_item(0);
        this.width = Math.max(300, ...this.rows.map((r) => (r.text.length + 1) * 7 + 50));
      } catch (e) {
        if (this.key === key) this.error = `Impossible de lire ce commit : ${e?.message ?? e}`;
      } finally { cx.notify(); }
    });
  }

  // Brings row `n` to the top of the diff. scroll_to_item moves a row to the nearest edge: going
  // up that is the top; going down it would be the bottom, so it aims at the row that ends up
  // last on screen once `n` is first (the visible range says how many rows fit).
  reveal(n) {
    const v = this.visible;
    if (!v || n < v.start) { this.scroll.scroll_to_item(n, "top"); return; }
    const fit = Math.max(1, v.end - v.start - 1);
    this.scroll.scroll_to_item(Math.min(this.rows.length - 1, n + fit - 1), "top");
  }

  sizeButton(id, icon, tip, enabled, action, t, kit) {
    return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(corner(6)).tooltip(tip)
      .text_color(enabled ? (kit ? kit.inkDim : t.muted) : t.dim).when(!enabled, (e) => e.opacity(0.4))
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(kit ? kit.hover : t.hover).text_color(kit ? kit.ink : t.foreground)).on_click(action))
      .child(svg(`mods/yozakura-chrome/${icon}.svg`).size(14));
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "f") return h_flex().w_full().h(20).flex_none().px(12).gap(6).items_center().bg(t.surface).border_t(1).border_color(t.border)
      .text_color(t.foreground).font_semibold().child(div().truncate().child(text));
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().text_color(kind === "" ? t.dim : t.foreground).child(text));
  }

  render(cx) {
    const pick = shared("yozakura.commit");
    this.load(pick, cx);
    const t = theme(), kit = shared("yozakura.shoji"), i = this.info;
    const mono = settings().font_family ?? "JetBrains Mono";
    const add = this.files.reduce((n, f) => n + (f.add ?? 0), 0), del = this.files.reduce((n, f) => n + (f.del ?? 0), 0);
    const paper = (el) => (kit ? div().px(4).rounded(3).bg(t.background).child(el) : el);
    const title = h_flex().h(kit ? 31 : 42).flex_none().px(14).gap(8).items_center()
      .when(!kit, (e) => e.border_b(1).border_color(t.border))
      .when(Boolean(kit), (e) => e.relative().overflow_hidden().text_color(kit.ink).children(rail(kit, 31)))
      .child(div().font_semibold().child("Commit"))
      .when(Boolean(i), (e) => e.child(div().px(6).py(1).rounded(corner(4)).bg(t.surface).font_family(mono).text_size(11).text_color(t.muted).child(i.short)))
      .child(div().flex_1())
      .when(this.files.length > 0, (e) => e.child(paper(div().text_size(11).text_color(t.ansi2).child(`+${add}`))).child(paper(div().text_size(11).text_color(t.ansi1).child(`−${del}`))))
      .child(this.sizeButton("commit-wider", "chevron-left", "Élargir", width() < MAX, () => resize(width() + STEP), t, kit))
      .child(this.sizeButton("commit-narrower", "chevron-right", "Rétrécir", width() > MIN, () => resize(width() - STEP), t, kit))
      .child(div().id("commit-close").size(24).flex_none().flex().items_center().justify_center().rounded(corner(6)).cursor_pointer()
        .text_color(kit ? kit.inkDim : t.muted).hover((s) => s.bg(kit ? kit.hover : t.hover).text_color(kit ? kit.ink : t.foreground))
        .on_click(() => this.close()).child(svg("mods/yozakura-chrome/x.svg").size(14)));
    const head = i ? v_flex().flex_none().px(14).py(10).gap(6).border_b(1).border_color(t.border)
      .child(div().font_semibold().text_color(t.foreground).child(i.subject || "(sans message)"))
      .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim).flex_wrap()
        .child(div().text_color(t.muted).child(i.author))
        .child(div().child(when(i.at)))
        .when(i.parents.length > 0, (e) => e.child(div().font_family(mono).child(`${i.parents.length > 1 ? "parents" : "parent"} ${i.parents.join(" ")}`))))
      .when(Boolean(i.body), (e) => e.child(div().id("commit-body").max_h(140).overflow_y_scroll().pt(2).text_size(12).text_color(t.muted)
        .children(i.body.split("\n").map((l, n) => div().id(`body-${n}`).min_h(16).child(l || " ")))))
      : null;
    const list = this.files.length ? div().flex_none().max_h(Math.min(this.files.length, 8) * 24 + 12).relative().border_b(1).border_color(t.border)
      .child(v_flex().id("commit-files").size_full().max_h(Math.min(this.files.length, 8) * 24 + 12).overflow_y_scroll().p(6)
        .children(this.files.map((f) => {
          const parts = f.path.split("/"), name = parts.pop();
          // Clicked: the diff scrolls to that file's header (a file cut from the diff has none).
          const start = this.starts.get(f.path);
          return h_flex().id(`commit-file-${f.path}`).h(24).flex_none().px(8).gap(8).items_center().text_size(12).rounded(corner(6))
            .when(start !== undefined, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { this.current = f.path; this.reveal(start); cx.notify(); }))
            .when(this.current === f.path, (e) => e.bg(t.selected))
            .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().min_w(0).truncate().child(name)))
            .child(f.add === null ? div().text_size(11).text_color(t.dim).child("binaire") : h_flex().gap(6)
              .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
              .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`))));
        })))
      : null;
    const empty = this.error ?? (pick?.hash ? "Chargement…" : "Choisissez un commit dans Commits");
    return v_flex().id("commit-detail").relative().size_full().min_h(0).overflow_hidden()
      .when(!kit, (e) => e.rounded(10).bg(t.background).border_1().border_color(t.border)).text_color(t.foreground).text_size(13)
      .child(title)
      .when(Boolean(head), (e) => e.child(head))
      .when(Boolean(list), (e) => e.child(list))
      .when(!i, (e) => e.child(div().p(14).text_color(this.error ? t.blocked : t.dim).child(empty)))
      .when(Boolean(i), (e) => e.child(div().flex_1().min_h(0).relative().font_family(mono).text_size(11)
        .child(div().id("commit-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.width).h_full().child(v_virtual_list("commit-diff", this.rows.length, 20, (n) => String(n),
            (range) => { this.visible = range; return this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t)); }).track_scroll(this.scroll).size_full())))
        .child(Scrollbar.vertical("commit-diff").viewport_from_layout().absolute().inset_0())
        .when(this.rows.length === 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Aucun changement de contenu")))))
      .when(this.cut, (e) => e.child(div().px(12).py(4).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child(`Diff coupé après ${MAX_LINES} lignes`)))
      // The left edge: pressed, it drags the panel's width; meanwhile a veil over the card
      // takes the pointer's moves and the release.
      .child(div().id("commit-edge").absolute().top(0).bottom(0).left(0).w(8).cursor_col_resize()
        .on_mouse_down("left", (e, cx) => { setShared("yozakura.commit.resize", { x: e.position.x, width: width() }); cx.stop_propagation(); }))
      .when(Boolean(shared("yozakura.commit.resize")), (e) => e.child(div().id("commit-resize-veil").absolute().inset_0().cursor_col_resize()
        .on_mouse_move((ev) => follow(ev.position.x))
        .on_mouse_up("left", () => setShared("yozakura.commit.resize", null))))
      .when(Boolean(shared("yozakura.dock.drag")), (e) => e.child(div().id("commit-drag-veil").absolute().inset_0().cursor_not_allowed()
        .on_mouse_up("left", () => setShared("yozakura.dock.drag", null))));
  }
}
