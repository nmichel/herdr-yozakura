// Yozakura: adapted from Herdr's shipped "workspace-chrome" mod (Apache License 2.0), changed for this layout.
// See THIRD_PARTY_NOTICES.md in the yozakura repository.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, settings, appHome, readTextFile, watchFolder } from "herdr";
import { startProjects } from "./projects.js";

// A #rrggbb color at an opacity (0..1), as #rrggbbaa. Other colors stay as they are.
const fade = (c, o) => typeof o !== "number" || o >= 1 || !/^#[0-9a-f]{6}$/i.test(c)
  ? c : c + Math.round(Math.max(0, o) * 255).toString(16).padStart(2, "0");
// The cards' fill at "opacity" in this mod's settings.json (1 when unset).
const islandFill = (c) => fade(c, shared("yozakura.opacity"));

// Each of the layout's themes (tsukiyo, yugure, harugasumi) brings its own sky, drawn by
// backgrounds/yozakura.py: picking one (Settings → Theme writes it on the layout's root,
// for the light or the dark appearance) puts its sky behind the cards. Other themes keep
// the sky shown.
const SKIES = {
  "tsukiyo": "backgrounds/tsukiyo.png",
  "yugure": "backgrounds/yugure.png",
  "harugasumi": "backgrounds/harugasumi.png",
};

// The shoji look (on unless "shoji": false in settings.json): every pane a sliding door, a wooden frame
// around washi. Each theme's kit: its textures (drawn by backgrounds/shoji.py), the frame's
// color (the pane border, plain), the line under a rail, the inks that read on its wood (at
// least 4.5:1 on its grain) and a hover tint over it. Shared as "yozakura.shoji" for the mods that draw
// cards and headers; null when off or for a theme without a kit.
const SHOJI = {
  "harugasumi": {
    paper: "mods/yozakura-chrome/shoji/paper-harugasumi.jpg",
    wood: "mods/yozakura-chrome/shoji/wood-hinoki.png",
    frame: "#c8a978", edge: "#a98656", ink: "#2f261f", inkDim: "#4a3b2e", hover: "#2f261f1a",
  },
  "yugure": {
    paper: "mods/yozakura-chrome/shoji/paper-yugure.jpg",
    wood: "mods/yozakura-chrome/shoji/wood-kuri.png",
    frame: "#4d3b2c", edge: "#2a1e15", ink: "#f1e8d8", inkDim: "#e2d6c2", hover: "#ffffff1a",
  },
  "tsukiyo": {
    paper: "mods/yozakura-chrome/shoji/paper-tsukiyo.jpg",
    wood: "mods/yozakura-chrome/shoji/wood-kuri.png",
    frame: "#4d3b2c", edge: "#22180f", ink: "#f1e8d8", inkDim: "#e2d6c2", hover: "#ffffff1a",
  },
};
let shojiWanted = false;

// What the layout should hold for the theme shown, rewritten there since it isn't a mod's:
// the sky; the main pane's fill, which "main_opacity" fades (the theme's background at that
// opacity; at 1, the plain theme color), or with shoji its washi, and its frame. Only writes
// when something differs; runs at start, when settings.json changes, and every second, to
// follow a theme picked meanwhile.
function applyLook() {
  const root = layout();
  const pane = find(root, "main")?.content?.pane;
  if (!pane) return;
  const name = typeof root.theme === "string" ? root.theme : root.theme?.[settings()?.dark ? "dark" : "light"];
  const kit = shojiWanted ? SHOJI[name] ?? null : null;
  if (JSON.stringify(shared("yozakura.shoji") ?? null) !== JSON.stringify(kit)) setShared("yozakura.shoji", kit);
  const o = shared("yozakura.mainOpacity");
  const fill = typeof o === "number" && o < 1 ? fade(theme().background, o) : "background";
  const frame = kit ? { width: 5, color: kit.frame } : { width: 1, color: "border" };
  const want = {
    background: kit ? { image: kit.paper, fit: "cover" } : fill,
    border: frame, focus: frame, radius: kit ? 4 : 14,
  };
  const paneChanged = Object.keys(want).some((k) => JSON.stringify(pane[k]) !== JSON.stringify(want[k]));
  // The cards: a thinner frame around the same paper; without shoji, the thin border and no
  // background of their own (their mods fill them).
  const card = kit
    ? { border: { width: 4, color: kit.frame }, radius: 4, background: { image: kit.paper, fit: "cover" } }
    : { border: { width: 1, color: "border" }, radius: 14, background: undefined };
  const cardsChanged = cards(root).some((id) => {
    const node = find(root, id);
    return node && Object.keys(card).some((k) => JSON.stringify(node[k]) !== JSON.stringify(card[k]));
  }) || SIDE.some((id) => {
    const node = find(root, id);
    return node && Object.keys(card).some((k) => JSON.stringify(node[k]) !== JSON.stringify(kit ? card[k] : undefined));
  });
  const sky = SKIES[name];
  const skyChanged = sky && root.background?.image !== sky;
  if (!paneChanged && !cardsChanged && !skyChanged) return;
  const next = JSON.parse(JSON.stringify(root));
  Object.assign(find(next, "main").content.pane, want);
  for (const id of cards(next)) {
    const node = find(next, id);
    if (!node) continue;
    Object.assign(node, card);
    if (!card.background) delete node.background;
  }
  for (const id of SIDE) {
    const node = find(next, id);
    if (!node) continue;
    if (kit) Object.assign(node, card);
    else for (const k of Object.keys(card)) delete node[k];
  }
  if (skyChanged) next.background = { ...(next.background ?? {}), image: sky };
  run("layout.set", { layout: next });
}
// The cards: every block of the sidebar (a private mod's widget too: see RECIPE.md) and the
// status bar.
function cards(root) {
  const ids = [];
  const walk = (n) => { for (const c of n?.children ?? []) c.type === "block" ? ids.push(c.id) : walk(c); };
  walk(find(root, "sidebar"));
  return [...ids, "status"];
}
// The side panel's blocks (yozakura-files, -changes, -history) and the commit detail beside
// it (yozakura-commit): cards like the others with shoji; without, their mods draw their own
// card, so the layout gives them nothing.
const SIDE = ["files", "changes", "commits", "commit"];

// The wood of a shoji rail, `h` px tall: its texture's strips side by side (as wide as any
// card), and a line under it unless the rail is the whole card.
function rail(kit, h, line = true) {
  return [
    h_flex().absolute().top(0).left(0).h_full().children([0, 1].map(() => image(kit.wood).w(Math.round((h * 4000) / 60)).h(h).flex_none())),
    line ? div().absolute().bottom(0).left(0).w_full().h(1).bg(kit.edge) : null,
  ].filter(Boolean);
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 112;
// The macOS rail holds the traffic lights (they reach 24 + 64 px) and the unfold chevron after
// them, and stays under the 112 px where the sidebar unfolds.
const MACOS_RAIL = 108;

// To the rail, or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? MACOS_RAIL : 44 });
}

export default class WorkspaceChrome extends View {
  // The header copy reads settings.json and shares both opacities with every yozakura mod,
  // again whenever the file changes.
  init(p, cx) {
    if (p?.footer) return;
    const dir = `${appHome()}/mods/yozakura-chrome`;
    const clamp = (v) => (typeof v === "number" ? Math.min(1, Math.max(0, v)) : 1);
    cx.spawn(async () => {
      for (;;) {
        let s = {};
        try { s = JSON.parse((await readTextFile(`${dir}/settings.json`)) ?? "{}"); } catch {}
        const o = clamp(s.opacity), main = clamp(s.main_opacity);
        shojiWanted = s.shoji !== false; // on unless turned off
        if (shared("yozakura.opacity") !== o) setShared("yozakura.opacity", o);
        if (shared("yozakura.mainOpacity") !== main) setShared("yozakura.mainOpacity", main);
        applyLook();
        await watchFolder(dir);
      }
    });
    cx.timer.every(1000, () => applyLook());
    startProjects(cx); // mods of your own tied to a repository (see projects.js)
  }
  button(id, label, action) {
    const t = theme();
    const kit = shared("yozakura.shoji");
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(kit ? kit.inkDim : t.muted)
      .hover(s => s.bg(kit ? kit.hover : t.hover).text_color(kit ? kit.ink : t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    // With shoji the layout gives the cards their paper and frame: no fill of their own.
    const kit = shared("yozakura.shoji");
    // A desktop, a panel or an agent card being dragged: these cards take no drop.
    const dragging = Boolean(shared("yozakura.dock.drag"));
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(collapsed ? 6 : 8).gap(9).items_center().rounded(8).when(collapsed, el => el.justify_center())
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).when(!dragging, el => el.cursor_pointer())
        .on_click(action).child(svg(`mods/yozakura-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(div().min_w(0).truncate().child(label)));
      return v_flex().size_full().overflow_hidden().when(!kit, el => el.rounded(13).bg(islandFill(t.chrome))).px(collapsed ? 5 : 8).py(kit ? 5 : 8).text_size(13) // its own card, no divider
        .when(dragging, el => el.cursor_not_allowed().on_mouse_up("left", () => setShared("yozakura.dock.drag", null))) // a release here cancels
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    // The brand card: with shoji, a rail of wood from end to end.
    const lights = window()?.platform === "macos" && !window()?.fullscreen;
    // On the macOS rail the traffic lights take the card's left: the chevron goes to its right end.
    const besideLights = collapsed && lights;
    const toggleIcon = collapsed ? "chevron-right" : "sidebar";
    return h_flex().size_full().overflow_hidden().when(!kit, el => el.rounded(13).bg(islandFill(t.chrome))).when(Boolean(kit), el => el.relative().rounded(1).children(rail(kit, 30, false)))
      .when(collapsed && !besideLights, el => el.justify_center()).when(besideLights, el => el.justify_end().pr(4))
      .when(!collapsed, el => el.pl(14).pr(10)).gap(4).items_center().text_size(13.5)
      .when(dragging, el => el.cursor_not_allowed().on_mouse_up("left", () => setShared("yozakura.dock.drag", null))) // a release here cancels
      .when(lights && !collapsed, el => el.pl(88)) // the lights (24 + 64 px), less the 12 px root padding, then 12 px
      .when(!collapsed, el => el.child(h_flex().flex_1().min_w(0).gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).flex_none().rounded(5)).child(div().min_w(0).truncate().font_semibold().text_color(kit ? kit.ink : t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/yozakura-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      .child(this.button("sidebar-toggle", svg(`mods/yozakura-chrome/${toggleIcon}.svg`).size(15), toggleSidebar));
  }
}
