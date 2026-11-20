// Yozakura: adapted from Herdr's shipped "git-history" mod (Apache License 2.0), changed for this layout.
// See THIRD_PARTY_NOTICES.md in the yozakura repository.
// Commits de la branche en cours et son état par rapport au distant.
// Suit le dossier du volet actif (comme Changes). Lecture seule, sauf le
// bouton « Fetch » qui lance `git fetch --prune` quand on clique dessus.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, settings, run, shared, setShared } from "herdr";
// The shoji look (shared "yozakura.shoji", see yozakura-chrome): the layout gives the card its
// paper and frame; the header is a rail of wood, `h` px tall (its texture's strips side by
// side, as wide as any card, and a line under it); corners inside are nearly square.
function rail(kit, h) {
  return [
    h_flex().absolute().top(0).left(0).h_full().children([0, 1].map(() => image(kit.wood).w(Math.round((h * 4000) / 60)).h(h).flex_none())),
    div().absolute().bottom(0).left(0).w_full().h(1).bg(kit.edge),
  ];
}
const corner = (r) => (shared("yozakura.shoji") ? 3 : r);


function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Lectures qui n'écrivent rien dans .git (sinon la surveillance du dossier relancerait sans fin).
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const FORMAT = "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct";
const LIMIT = 100;

function parse(out) {
  return out.split("\n").filter(Boolean).map((l) => {
    const [hash, short, subject, author, ct] = l.split("\x1f");
    return { hash, short, subject, author, time: Number(ct) };
  });
}

function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "à l'instant";
  const m = s / 60, h = m / 60, d = h / 24;
  if (m < 60) return `il y a ${Math.floor(m)} min`;
  if (h < 24) return `il y a ${Math.floor(h)} h`;
  if (d < 30) return `il y a ${Math.floor(d)} j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${Math.floor(d / 365)} an${d >= 730 ? "s" : ""}`;
}

export default class GitHistory extends View {
  init(_props, cx) {
    this.reset();
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  reset() {
    this.root = null; this.gitdir = null; this.branch = null; this.upstream = null;
    this.ahead = 0; this.behind = 0; this.commits = []; this.incoming = [];
    this.outgoing = new Set(); this.base = null; this.open = null; this.stat = []; this.error = null;
    this.note = null; this.watched = null;
  }

  watch(gitdir, cx) {
    if (this.on || this.watched === gitdir) return;
    this.watched = gitdir;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === gitdir) {
          await watchFolder(gitdir);
          if (this.watched === gitdir) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.fetching) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) { this.context = context; this.reset(); }
    if (!cwd) return;
    this.on = on;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const run = (args, dir = cwd) => exec("git", [...READ, ...args], { cwd: dir, on });
        const top = await run(["rev-parse", "--show-toplevel", "--absolute-git-dir"]);
        if (key() !== context) return;
        if (top.code !== 0) { this.reset(); this.error = "Pas un dépôt git"; return; }
        const [root, gitdir] = top.stdout.trim().split("\n");
        this.root = root; this.gitdir = gitdir;
        const git = (args) => run(args, root);
        const head = await git(["symbolic-ref", "--short", "-q", "HEAD"]);
        this.branch = head.code === 0 ? head.stdout.trim() : null;
        if (!this.branch) {
          const sha = await git(["rev-parse", "--short", "HEAD"]);
          this.detached = sha.code === 0 ? sha.stdout.trim() : null;
        } else this.detached = null;
        const up = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
        this.upstream = up.code === 0 ? up.stdout.trim() : null;
        if (this.upstream) {
          const counts = await git(["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
          [this.ahead, this.behind] = counts.stdout.trim().split(/\s+/).map(Number);
          const out = await git(["rev-list", "-n", String(LIMIT), "@{u}..HEAD"]);
          this.outgoing = new Set(out.stdout.split("\n").filter(Boolean));
          const inc = await git(["log", FORMAT, "-n", "50", "HEAD..@{u}"]);
          this.incoming = parse(inc.stdout);
        } else {
          // Pas de branche distante : on compare avec la branche par défaut du distant.
          this.incoming = [];
          this.base = null;
          const def = await git(["rev-parse", "--abbrev-ref", "origin/HEAD"]);
          for (const ref of [def.code === 0 ? def.stdout.trim() : null, "origin/main", "origin/master"]) {
            if (!ref || ref === "origin/HEAD") continue;
            const ok = await git(["rev-parse", "--verify", "-q", ref]);
            if (ok.code === 0) { this.base = ref; break; }
          }
          if (this.base) {
            const counts = await git(["rev-list", "--left-right", "--count", `HEAD...${this.base}`]);
            [this.ahead, this.behind] = counts.stdout.trim().split(/\s+/).map(Number);
          } else { this.ahead = 0; this.behind = 0; }
          // Commits présents sur aucune branche distante.
          const out = await git(["rev-list", "-n", String(LIMIT), "HEAD", "--not", "--remotes"]);
          this.outgoing = new Set(out.stdout.split("\n").filter(Boolean));
        }
        const log = await git(["log", FORMAT, "-n", String(LIMIT), "HEAD"]);
        this.commits = log.code === 0 ? parse(log.stdout) : [];
        this.error = log.code === 0 || this.commits.length ? null : "Aucun commit pour l'instant";
        if (key() === context) this.watch(gitdir, cx);
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  fetch(cx) {
    if (!this.root || this.fetching) return;
    this.fetching = true; this.note = null; cx.notify();
    const root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", ["fetch", "--prune"], { cwd: root, on, timeout: 120000 });
        if (r.code !== 0) this.note = (r.stderr || "Échec du fetch").trim().split("\n").pop();
        else this.fetchedAt = Date.now();
      } catch (e) { this.note = String(e?.message ?? e); }
      finally { this.fetching = false; this.refresh(cx); cx.notify(); }
    });
  }

  pick(hash, cx) {
    if (this.open === hash) { this.open = null; this.stat = []; cx.notify(); return; }
    this.open = hash; this.stat = []; cx.notify();
    const root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      const r = await exec("git", [...READ, "show", "--stat=60", "--format=%b", hash], { cwd: root, on });
      if (this.open !== hash) return;
      this.stat = r.stdout.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(0, 40);
      cx.notify();
    });
  }

  row(c, t, kind) {
    const mono = settings().font_family ?? "JetBrains Mono";
    const unpushed = kind === "out";
    const incoming = kind === "in";
    const dot = incoming
      ? div().size(9).rounded(5).border_1().border_color(t.working)
      : div().size(9).rounded(5).when(unpushed, (e) => e.bg(t.accent)).when(!unpushed, (e) => e.border_1().border_color(t.dim));
    const open = this.open === c.hash;
    return v_flex().id(`commit-${kind}-${c.hash}`).flex_none().px(8).py(6).gap(2).rounded(corner(7)).cursor_pointer()
      .when(open, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.pick(c.hash, cx))
      .child(h_flex().gap(8).items_center()
        .child(h_flex().w(12).flex_none().justify_center().child(dot))
        .child(div().flex_1().min_w(0).truncate().text_color(incoming ? t.muted : t.foreground).child(c.subject || "(sans message)")))
      .child(h_flex().pl(20).gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().font_family(mono).text_color(unpushed ? t.accent : incoming ? t.working : t.muted).child(c.short))
        .child(div().min_w(0).truncate().child(c.author))
        .child(div().flex_1())
        .child(div().flex_none().child(ago(c.time))))
      .when(open && this.stat.length > 0, (e) => e.child(v_flex().mt(4).ml(20).p(8).rounded(corner(6)).bg(t.surface)
        .font_family(mono).text_size(10.5).text_color(t.muted)
        .children(this.stat.map((l, i) => div().id(`stat-${i}`).truncate().child(l)))));
  }

  status(t) {
    const pill = (text, color) => div().px(6).py(1).rounded(4).border_1().border_color(color).text_size(11).text_color(color).child(text);
    if (!this.root) return null;
    if (!this.branch) return h_flex().gap(6).items_center().child(pill("HEAD détachée", t.blocked)).child(div().text_size(11).text_color(t.dim).child(this.detached ?? ""));
    if (!this.upstream) return h_flex().gap(6).items_center().flex_wrap()
      .child(pill("Jamais poussée", t.blocked))
      .when(this.outgoing.size > 0, (e) => e.child(pill(`${this.outgoing.size >= LIMIT ? LIMIT + "+" : this.outgoing.size} non poussés`, t.accent)))
      .when(Boolean(this.base), (e) => e.child(div().text_size(11).text_color(t.dim)
        .child(`${this.ahead} en avance, ${this.behind} en retard sur ${this.base}`)));
    const sync = this.ahead === 0 && this.behind === 0;
    return h_flex().gap(6).items_center().flex_wrap()
      .child(div().text_size(11).text_color(t.muted).child(this.upstream))
      .when(sync, (e) => e.child(pill("✓ à jour", t.done)))
      .when(this.ahead > 0, (e) => e.child(pill(`↑ ${this.ahead} à pousser`, t.accent)))
      .when(this.behind > 0, (e) => e.child(pill(`↓ ${this.behind} à récupérer`, t.working)));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme();
    const section = (label, count) => h_flex().flex_none().px(8).pt(10).pb(4).gap(6).items_center().text_size(11).text_color(t.dim)
      .child(div().font_semibold().child(label)).when(count != null, (e) => e.child(div().child(String(count))));
    const rows = [];
    if (this.incoming.length) {
      rows.push(section("À récupérer", this.behind));
      rows.push(...this.incoming.map((c) => this.row(c, t, "in")));
    }
    if (this.commits.length) {
      rows.push(section(this.branch ?? "HEAD", null));
      rows.push(...this.commits.map((c) => this.row(c, t, this.outgoing.has(c.hash) ? "out" : "pushed")));
      if (this.commits.length >= LIMIT) rows.push(div().px(8).py(6).text_size(11).text_color(t.dim).child(`Les ${LIMIT} derniers commits`));
    }
    const empty = this.error || (this.loading ? "Chargement…" : this.root ? "Aucun commit" : "Aucun dossier");
    const kit = shared("yozakura.shoji");
    // With shoji the title row is a rail of wood, and what follows it sits on the paper below.
    const button = (el) => el.h(24).px(8).gap(5).items_center().rounded(corner(6)).border_1().border_color(kit ? kit.inkDim : t.border).text_size(11)
      .hover((s) => s.bg(kit ? kit.hover : t.hover).text_color(kit ? kit.ink : t.foreground));
    const title = h_flex().gap(8).items_center()
      .when(Boolean(kit), (e) => e.h(31).flex_none().px(14).relative().overflow_hidden().text_color(kit.ink).children(rail(kit, 31)))
      .child(div().font_semibold().child("Commits"))
      .when(Boolean(this.branch), (e) => e.child(div().min_w(0).truncate().px(6).py(1).rounded(corner(4)).bg(t.surface).text_size(11).text_color(t.muted).child(this.branch)))
      .child(div().flex_1())
      .when(Boolean(this.root), (e) => e.child(button(h_flex().id("git-changes")).text_color(kit ? kit.inkDim : t.muted)
        .on_click(() => run("layout.select", { stack: "panel-body", child: "changes" }))
        .child(svg("mods/yozakura-changes/changes.svg").size(12))
        .child("Changes")))
      .when(Boolean(this.root), (e) => e.child(button(h_flex().id("git-fetch")).text_color(kit ? kit.inkDim : this.fetching ? t.dim : t.muted)
        .on_click((_e, cx) => this.fetch(cx))
        .child(this.fetching ? svg("mods/yozakura-history/fetch.svg").size(12).spin(900) : svg("mods/yozakura-history/fetch.svg").size(12))
        .child(this.fetching ? "Fetch…" : "Fetch")));
    const status = this.status(t);
    const extra = [status || null, this.note ? div().text_size(11).text_color(t.blocked).child(this.note) : null].filter(Boolean);
    const header = kit
      ? v_flex().flex_none().child(title).when(extra.length > 0, (e) => e.child(v_flex().px(14).py(8).gap(6).border_b(1).border_color(t.border).children(extra)))
      : v_flex().flex_none().px(14).py(10).gap(6).border_b(1).border_color(t.border).child(title).children(extra);
    return v_flex().id("git-history").relative().size_full().min_h(0).overflow_hidden().when(!kit, (e) => e.rounded(10).bg(t.background).border_1().border_color(t.border)).text_color(t.foreground).text_size(13)
      .child(header)
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("git-history-list").absolute().inset_0().overflow_y_scroll().p(6)
          .children(rows.length ? rows : [div().p(8).text_color(t.dim).child(empty)]))
        .child(Scrollbar.vertical("git-history-list").absolute().inset_0()))
      // Something dragged (a desktop, a panel, an agent card): no drop here. A veil keeps the
      // no-drop pointer over the rows' own, and letting go on it cancels the drag.
      .when(Boolean(shared("yozakura.dock.drag")), (e) => e.child(div().id("history-drag-veil").absolute().inset_0().cursor_not_allowed()
        .on_mouse_up("left", () => setShared("yozakura.dock.drag", null))));
  }
}
