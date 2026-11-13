// Yozakura: adapted from Herdr's shipped "workspace-chrome" mod (Apache License 2.0), changed for this layout.
// See THIRD_PARTY_NOTICES.md in the yozakura repository.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, settings, appHome, readTextFile, watchFolder } from "herdr";

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

// What the layout should hold for the theme shown, rewritten there since it isn't a mod's:
// the sky, and the main pane's fill, which "main_opacity" fades (the theme's background at
// that opacity; at 1, the plain theme color). Only writes when something differs; runs at
// start, when settings.json changes, and every second, to follow a theme picked meanwhile.
function applyLook() {
  const root = layout();
  const pane = find(root, "main")?.content?.pane;
  if (!pane) return;
  const o = shared("yozakura.mainOpacity");
  const fill = typeof o === "number" && o < 1 ? fade(theme().background, o) : "background";
  const name = typeof root.theme === "string" ? root.theme : root.theme?.[settings()?.dark ? "dark" : "light"];
  const sky = SKIES[name];
  const skyChanged = sky && root.background?.image !== sky;
  if (pane.background === fill && !skyChanged) return;
  const next = JSON.parse(JSON.stringify(root));
  find(next, "main").content.pane.background = fill;
  if (skyChanged) next.background = { ...(next.background ?? {}), image: sky };
  run("layout.set", { layout: next });
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
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 100;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
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
        if (shared("yozakura.opacity") !== o) setShared("yozakura.opacity", o);
        if (shared("yozakura.mainOpacity") !== main) setShared("yozakura.mainOpacity", main);
        applyLook();
        await watchFolder(dir);
      }
    });
    cx.timer.every(1000, () => applyLook());
  }
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(collapsed ? 6 : 8).gap(9).items_center().rounded(8).when(collapsed, el => el.justify_center())
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/yozakura-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(div().min_w(0).truncate().child(label)));
      return v_flex().size_full().rounded(13).overflow_hidden().bg(islandFill(t.chrome)).px(collapsed ? 5 : 8).py(8).text_size(13) // its own card, no divider
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex().size_full().rounded(13).overflow_hidden().bg(islandFill(t.chrome)).when(collapsed, el => el.justify_center()).when(!collapsed, el => el.pl(14).pr(10)).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().min_w(0).gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).flex_none().rounded(5)).child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/yozakura-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/yozakura-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
