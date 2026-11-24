// Project plugins: a mod of your own, tied to one repository, that runs while a space works
// in it. Nothing in the published layout names it: its mod.json says which repository,
//   { "place": "none", "title": "…", "project": "~/path/to/repo" }
// and this starts it by putting a floating block of it, drawing nothing, on the layout's root:
//   { id: "project-<mod>", content: { mod: "<mod>", props: { role: "watch" } } }
// (a mod runs only while a block of it is in the layout, and a hidden block never starts it).
// From there the mod does the rest: its own blocks (a widget, a column), shown or hidden as it
// sees fit. When no space works in the repository any more, the floating block goes (the mod
// stops) and the mod's other blocks are hidden, so none is left showing a stale state.
//
// A space works in a repository when one of its local terminals has its folder in it: the
// folder's git repository, its main checkout for a worktree (`git rev-parse --git-common-dir`,
// so a worktree anywhere counts), is the declared one, or the folder is inside it.
// Read every 2 s: the mods folder's mod.json files that declare a project (again when the
// folder changes), and each terminal folder's repository (kept for a minute).
import { run, layout, appHome, home, exec, spaces, panes, readTextFile, watchFolder } from "herdr";

const PREFIX = "project-";
const EVERY = 2000;
const KEEP = 60000; // how long a folder's repository is trusted

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const expand = (path) => (path.startsWith("~/") ? `${home()}/${path.slice(2)}` : path).replace(/\/+$/, "");
const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);

export function startProjects(cx) {
  let plugins = null; // [{ mod, project }], once read
  const repos = new Map(); // folder -> { root, at }
  let busy = false;

  // The mods that declare a project, read again whenever the mods folder changes.
  cx.spawn(async () => {
    const dir = `${appHome()}/mods`;
    for (;;) {
      try {
        const r = await exec("sh", ["-c", `cd ${JSON.stringify(dir)} && grep -l '"project"' */mod.json 2>/dev/null`]);
        const found = [];
        for (const file of r.stdout.split("\n").filter(Boolean)) {
          try {
            const json = JSON.parse((await readTextFile(`${dir}/${file}`)) ?? "{}");
            if (typeof json.project === "string" && json.project) found.push({ mod: file.split("/")[0], project: expand(json.project) });
          } catch {}
        }
        plugins = found;
      } catch {}
      await watchFolder(dir);
    }
  });

  // A folder's repository: its main checkout's root, or null outside git.
  async function repo(folder) {
    const known = repos.get(folder);
    if (known && Date.now() - known.at < KEEP) return known.root;
    let root = null;
    try {
      const r = await exec("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (r.code === 0) root = r.stdout.trim().replace(/\/\.git\/?$/, "").replace(/\/+$/, "");
    } catch {}
    repos.set(folder, { root, at: Date.now() });
    return root;
  }

  cx.timer.every(EVERY, () => {
    if (busy || !plugins) return;
    if (!plugins.length) { apply(new Set()); return; }
    busy = true;
    cx.spawn(async () => {
      try {
        // Every local terminal's folder, in any space.
        const tabs = new Set(spaces().filter((s) => !s.machine).flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
        const folders = [...new Set(panes().filter((p) => p.terminal && !p.terminal.includes("/") && tabs.has(p.tab) && p.cwd).map((p) => p.cwd))];
        const active = new Set();
        for (const folder of folders) {
          const root = await repo(folder);
          for (const p of plugins) if (inside(folder, p.project) || (root && inside(root, p.project))) active.add(p.mod);
        }
        apply(active);
      } catch {}
      finally { busy = false; }
    });
  });

  // The layout as it should be: a floating block for each active plugin; the other plugins'
  // floating blocks gone and their blocks hidden. One layout.set, only when something differs.
  function apply(active) {
    const root = layout();
    if (!root) return;
    const declared = new Set((plugins ?? []).map((p) => p.mod));
    const floating = root.floating ?? [];
    const ours = (f) => f.id?.startsWith(PREFIX);
    const want = [...active].sort();
    const have = floating.filter(ours).map((f) => f.content?.mod).sort();
    const stale = [];
    const walk = (n) => {
      for (const c of n?.children ?? []) {
        const mod = c.content?.mod;
        if (mod && declared.has(mod) && !active.has(mod) && !c.hidden) stale.push(c.id);
        walk(c);
      }
    };
    walk(root);
    if (JSON.stringify(want) === JSON.stringify(have) && !stale.length) return;
    const next = JSON.parse(JSON.stringify(root));
    next.floating = [
      ...floating.filter((f) => !ours(f)),
      ...want.map((mod) => floating.find((f) => ours(f) && f.content?.mod === mod)
        ?? { id: `${PREFIX}${mod}`, content: { mod, props: { role: "watch" } }, edge: "bottom", align: "end" }),
    ];
    if (!next.floating.length) delete next.floating;
    for (const id of stale) { const n = find(next, id); if (n) n.hidden = true; }
    run("layout.set", { layout: next });
  }
}
