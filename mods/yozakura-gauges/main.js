// Yozakura: this computer's load, as four gauges over the sidebar's footer: CPU, memory,
// disk and network. Read every 2 s from macOS's own tools (one shell, nothing installed):
//   CPU      iostat's second sample (1 s): 100 − idle;
//   memory   vm_stat, as Activity Monitor's "memory used": app (anonymous − purgeable),
//            wired and compressed pages, over hw.memsize;
//   disk     iostat's MB/s, all disks;
//   network  netstat -ib bytes in + out of the en* interfaces, between two reads.
// CPU and memory fill in proportion, colored as the status bar's gauges: green under 50 %,
// yellow to 79 %, red from 80 %. Disk and network have no ceiling and fill in blue (the
// theme's "done"): their gauges are logarithmic, from 1 KB/s (empty) to DISK_MAX and NET_MAX
// (full), so small activity shows and a burst doesn't flatten the rest.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, shared, setShared, layout, exec } from "herdr";

const EVERY = 2000;
const DISK_MAX = 2e9; // B/s
const NET_MAX = 125e6; // B/s, a gigabit link

const fade = (c, o) => typeof o !== "number" || o >= 1 || !/^#[0-9a-f]{6}$/i.test(c)
  ? c : c + Math.round(Math.max(0, o) * 255).toString(16).padStart(2, "0");
const islandFill = (c) => fade(c, shared("yozakura.opacity"));

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// The sidebar's rail goes by its width, as in yozakura-chrome.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 112;

const SCRIPT = "iostat -C -c 2 -w 1 | tail -1; echo @; vm_stat; echo @; sysctl -n hw.memsize; echo @; netstat -ibn";

function rate(bytes) {
  if (bytes < 1e3) return `${Math.round(bytes)} B/s`;
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB/s`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB/s`;
  return `${(bytes / 1e9).toFixed(1)} GB/s`;
}
const logShare = (bytes, max) => (bytes <= 1e3 ? 0 : Math.min(1, Math.log10(bytes / 1e3) / Math.log10(max / 1e3)));

export default class Gauges extends View {
  init(_props, cx) {
    this.load = null; // { cpu, mem, memUsed, memTotal, disk, netIn, netOut }
    this.net = null; // { at, in, out }: the last counters
    this.read(cx);
    cx.timer.every(EVERY, (cx) => this.read(cx));
  }

  read(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", SCRIPT]);
        const [io, vm, total, net] = r.stdout.split("@\n");
        // iostat: per disk KB/t tps MB/s, then us sy id and the three load averages.
        const f = io.trim().split(/\s+/).map(Number);
        const disks = f.slice(0, f.length - 6);
        let disk = 0;
        for (let i = 2; i < disks.length; i += 3) disk += disks[i] * 1e6;
        const cpu = 100 - f[f.length - 4];
        const page = Number(/page size of (\d+)/.exec(vm)?.[1] ?? 16384);
        const pages = (name) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0);
        const memUsed = (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page;
        const memTotal = Number(total.trim());
        // netstat -ib: one <Link#n> row per interface; bytes in and out are 4th and 2nd from the end.
        let inB = 0, outB = 0;
        for (const line of net.split("\n")) {
          const c = line.trim().split(/\s+/);
          if (!/^en\d+$/.test(c[0]) || !/^<Link#/.test(c[2] ?? "")) continue;
          inB += Number(c[c.length - 5]);
          outB += Number(c[c.length - 2]);
        }
        const now = Date.now();
        const last = this.net;
        this.net = { at: now, in: inB, out: outB };
        const dt = last ? (now - last.at) / 1000 : 0;
        const per = (a, b) => (dt > 0 && a >= b ? (a - b) / dt : 0);
        this.load = {
          cpu: Math.max(0, Math.min(100, cpu)),
          mem: memTotal ? Math.min(100, (memUsed / memTotal) * 100) : 0,
          memUsed, memTotal, disk,
          netIn: last ? per(inB, last.in) : 0,
          netOut: last ? per(outB, last.out) : 0,
        };
        cx.notify();
      }
      catch {}
      finally { this.reading = false; }
    });
  }

  gauges(t) {
    const l = this.load ?? { cpu: 0, mem: 0, memUsed: 0, memTotal: 0, disk: 0, netIn: 0, netOut: 0 };
    const level = (p) => (p >= 80 ? t.ansi1 : p >= 50 ? t.ansi3 : t.ansi2);
    const gb = (b) => `${(b / 2 ** 30).toFixed(1)} GB`;
    const net = l.netIn + l.netOut;
    const known = Boolean(this.load);
    return [
      { id: "cpu", label: "CPU", share: l.cpu / 100, color: level(l.cpu), level: true, value: known ? `${Math.round(l.cpu)} %` : "–", tip: `CPU: ${Math.round(l.cpu)} %` },
      { id: "mem", label: "Memory", share: l.mem / 100, color: level(l.mem), level: true, value: known ? `${Math.round(l.mem)} %` : "–", tip: `Memory: ${gb(l.memUsed)} of ${gb(l.memTotal)}` },
      { id: "disk", label: "Disk", share: logShare(l.disk, DISK_MAX), color: t.done, value: known ? rate(l.disk) : "–", tip: `Disk: ${rate(l.disk)}` },
      { id: "net", label: "Network", share: logShare(net, NET_MAX), color: t.done, value: known ? rate(net) : "–", tip: `Network: ↓ ${rate(l.netIn)} · ↑ ${rate(l.netOut)}` },
    ];
  }

  render() {
    const t = theme();
    const kit = shared("yozakura.shoji");
    const collapsed = narrow();
    const dragging = Boolean(shared("yozakura.dock.drag"));
    const gauges = this.gauges(t);
    const card = v_flex().size_full().overflow_hidden().when(!kit, el => el.rounded(13).bg(islandFill(t.chrome))).text_size(11.5)
      .when(dragging, el => el.cursor_not_allowed().on_mouse_up("left", () => setShared("yozakura.dock.drag", null))); // a release here cancels
    // The rail: four upright bars side by side, the reading in their tooltips.
    if (collapsed) {
      return card.items_center().justify_center().py(kit ? 6 : 10).child(h_flex().h_full().gap(3).items_end()
        .children(gauges.map(g => v_flex().id(`gauge-${g.id}`).w(5).h_full().rounded(2).overflow_hidden().bg(t.input).justify_end().tooltip(g.tip)
          .child(div().w_full().h(`${Math.round(g.share * 100)}%`).min_h(g.share > 0 ? 2 : 0).bg(g.color)))));
    }
    return card.px(14).py(kit ? 6 : 10).gap(5).justify_center()
      .children(gauges.map(g => h_flex().id(`gauge-${g.id}`).h(16).gap(8).items_center().tooltip(g.tip)
        .child(div().w(52).flex_none().text_color(t.muted).child(g.label))
        .child(div().flex_1().h(7).rounded(2).bg(t.input).overflow_hidden()
          .child(div().h_full().w(`${Math.round(g.share * 100)}%`).bg(g.color)))
        .child(div().w(62).flex_none().text_right().text_color(g.level ? g.color : t.foreground).child(g.value))));
  }
}
