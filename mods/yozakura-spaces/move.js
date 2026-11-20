// Moving a desktop, or one of its panels, into a space: what a drop on a space does (its row
// in the sidebar, or its desktops bar once the space is shown). Herdr has no command that moves
// a tab to another space, so each terminal leaves its pane (terminal.park: it keeps running)
// and comes back in the space shown (terminal.keep: a new tab, or beside the focused pane).
// A desktop of several panels comes back with the same splits in the same order, each split
// half and half (no command sizes a pane). A panel that isn't a terminal (a mod) stays behind.

import { spaces, panes, terminals, run, notify, exec, home } from "herdr";

const paneOf = (terminal) => panes().find((p) => p.terminal === terminal)?.pane ?? null;
const coreOf = (terminal) => terminals().find((k) => k.address === terminal && k.state === "live") ?? null;

// terminal.park answers at once but finishes in the core later, dropping the terminal's space
// and tab labels and its keep; a terminal.keep sent before that is lost. So each step waits
// for the core (as yozakura-pane does): parked = no pane and no tab label left; placed = a
// pane and its tab label.
const parked = (terminal) => {
  const k = coreOf(terminal);
  return Boolean(k) && !paneOf(terminal) && !k.labels?.["herdr.tab"] && k.keep !== true;
};
const placed = (terminal) => Boolean(paneOf(terminal)) && Boolean(coreOf(terminal)?.labels?.["herdr.tab"]);

async function until(cx, ok, ms = 5000) {
  for (let i = 0; i < ms / 50 && !ok(); i++) await cx.sleep(50);
  return ok();
}

// Takes the terminal's pane away (a tab left empty closes), then gives it one in the space
// shown: a new tab, or `direction` ("right", "down") of the pane `beside`.
async function place(cx, terminal, beside = null, direction = null) {
  if (paneOf(terminal)) {
    run("terminal.park", { terminal });
    if (!(await until(cx, () => parked(terminal)))) return false;
  }
  if (beside) run("pane.focus", { pane: beside });
  run("terminal.keep", beside ? { terminal, place: direction } : { terminal });
  return until(cx, () => placed(terminal));
}

// A terminal that didn't land goes back to a desktop of its own once its park is over;
// failing that, a notification brings it back when clicked. One never parked stays put.
async function rescue(cx, terminal) {
  for (let i = 0; i < 3; i++) {
    if (!coreOf(terminal) || placed(terminal)) return;
    if (!(await until(cx, () => parked(terminal) || placed(terminal))) || placed(terminal)) continue;
    run("terminal.keep", { terminal });
    if (await until(cx, () => placed(terminal))) return;
  }
  if (!coreOf(terminal) || placed(terminal)) return;
  notify({
    title: "Couldn't move the terminal",
    body: `${terminal} still runs, without a pane. Click to bring it back in a desktop of its own.`,
    level: "error",
    action: { name: "terminal.keep", args: { terminal } },
  });
}

// The desktop's splits, from the core's own record of the tabs: the app shares no tree, so its
// file is read. Null when it can't be (another machine's desktop, another format).
async function splitsOf(tabId) {
  if (tabId.includes("/")) return null;
  try {
    const file = await exec("cat", [`${home()}/.local/state/herdr-core/default/docs.json`]);
    const doc = JSON.parse(file.stdout)?.["herdr-app"]?.value;
    for (const space of doc?.spaces ?? []) {
      const tab = (space.tabs ?? []).find((t) => t.id === tabId);
      if (tab?.root) return tab.root;
    }
  } catch {}
  return null;
}

// Without its splits, the desktop's terminals come back side by side, in the order shown.
const sideBySide = (tabId) => ({
  type: "row",
  children: panes().filter((p) => p.tab === tabId && p.terminal).map((p) => ({ type: "block", content: { terminal: p.terminal } })),
});

const firstTerminal = (node) =>
  node?.type === "block" ? node.content?.terminal ?? null : (node?.children ?? []).map(firstTerminal).find(Boolean) ?? null;

// Puts a split's terminals around its first one, already placed: each child's first terminal
// beside the previous child's (right in a row, down in a column), then each child's own splits.
async function rebuild(cx, node, failed) {
  const children = (node.children ?? []).filter((child) => firstTerminal(child));
  const direction = node.type === "row" ? "right" : "down";
  for (let i = 1; i < children.length; i++) {
    const terminal = firstTerminal(children[i]);
    const previous = paneOf(firstTerminal(children[i - 1]));
    if (!previous || !(await place(cx, terminal, previous, direction))) failed.push(terminal);
  }
  for (const child of children) if (child.type !== "block") await rebuild(cx, child, failed);
}

// drag: the shared "yozakura.dock.drag", { terminal, tab, desktop }: a panel (its terminal),
// or a whole desktop (`desktop`; its terminal when it's its only panel).
const moving = new Set();
export async function moveToSpace(cx, drag, spaceId) {
  const key = drag.terminal ?? drag.tab;
  if (moving.has(key)) return;
  moving.add(key);
  try { await move(cx, drag, spaceId); } finally { moving.delete(key); }
}

async function move(cx, drag, spaceId) {
  const source = spaces().find((s) => s.tabs.some((tab) => tab.id === drag.tab));
  const target = spaces().find((s) => s.id === spaceId);
  if (!source || !target || (source.machine ?? null) !== (target.machine ?? null)) return;
  const desk = source.tabs.find((tab) => tab.id === drag.tab);
  const name = drag.desktop && desk?.named ? desk.name : null;
  const root = drag.terminal ? { type: "block", content: { terminal: drag.terminal } } : (await splitsOf(drag.tab)) ?? sideBySide(drag.tab);
  const first = firstTerminal(root);
  if (!first) return;
  run("space.select", { id: spaceId });
  if (!(await place(cx, first))) return rescue(cx, first);
  const label = coreOf(first)?.labels?.["herdr.tab"];
  const tab = spaces().find((s) => s.id === spaceId)?.tabs.find((t) => t.id === label || t.id.endsWith(`/${label}`));
  if (name && tab) run("tab.rename", { id: tab.id, name });
  const failed = [];
  await rebuild(cx, root, failed);
  for (const terminal of failed) await rescue(cx, terminal);
  const landed = paneOf(first);
  if (landed) run("pane.focus", { pane: landed });
}
