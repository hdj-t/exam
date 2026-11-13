// Network Security · Experiment 1 — Lab Tools and Simulators (Packet Tracer, Command Prompt, Wireshark).
(() => {
  const { h } = Lab;
  const net = new Net.Network();
  const PC0 = net.pc("PC0", { name: "PC0", mac: "0001.C7A4.3B01" });
  const PC1 = net.pc("PC1", { name: "PC1", mac: "0060.47D2.9E02" });
  const SW = net.switch("SW", { hostname: "Switch", mac: "0090.2B11.6C00" });
  net.booting = false;
  const PORT = { PC0: "FastEthernet0/1", PC1: "FastEthernet0/2" };
  const linked = (pc) => !!net.linkAt(pc, "FastEthernet0");
  const flag = { win: new Set(), filters: new Set() };
  const sim = { on: false, keep: { ARP: true, ICMP: true, STP: true, CDP: true, DNS: true }, events: [], pos: 0 };

  Lab.start({
    brief: `
<p>Get to know the network-security lab tools: build a two-PC LAN in <b>Cisco Packet Tracer</b>, test it with <code>ping</code>, watch <b>ARP</b> and <b>ICMP</b> in Simulation Mode, use basic <b>Windows network commands</b>, and try <b>Wireshark</b> display filters.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>Tool</th><th>Main purpose</th></tr>
<tr><td>Cisco Packet Tracer</td><td>Build, configure and simulate networks</td></tr>
<tr><td>Command Prompt</td><td>Run basic network commands such as ipconfig and ping</td></tr>
<tr><td>Wireshark</td><td>Capture and inspect network packets</td></tr></table></div>
<h3>Addressing</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Device</th><th>IP address</th><th>Mask</th><th>Gateway</th></tr>
<tr><td>PC0</td><td>192.168.1.10</td><td>255.255.255.0</td><td>leave empty</td></tr>
<tr><td>PC1</td><td>192.168.1.20</td><td>255.255.255.0</td><td>leave empty</td></tr></table></div>
<p class="key"><b>Why no router?</b> Both PCs are in the same IP network (192.168.1.0/24), so they talk through the switch directly.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>Protocol</th><th>Purpose</th></tr>
<tr><td>ARP</td><td>Finds the MAC address associated with an IPv4 address</td></tr>
<tr><td>ICMP</td><td>Used by ping to send Echo Request and Echo Reply</td></tr></table></div>
<p class="note"><b>Safety:</b> use tools only on lab systems. Authorisation is required before any network-security test.</p>`,
    setup(api) {
      const topo = new api.Topo({
        w: 340, h: 190, label: "PC0 and PC1 connected to Switch0",
        nodes: [
          { id: "SW", kind: "switch", label: "Switch0", sub: "2960", x: 170, y: 50 },
          { id: "PC0", kind: "pc", label: "PC0", x: 75, y: 145 },
          { id: "PC1", kind: "pc", label: "PC1", x: 265, y: 145 },
        ],
        links: [{ a: "PC0", b: "SW", al: "Fa0", bl: "Fa0/1" }, { a: "PC1", b: "SW", al: "Fa0", bl: "Fa0/2" }],
        onClick: (id) => api.show(id),
      });
      const cable = h("select", { class: "qz-sel", style: "max-inline-size:15rem", "aria-label": "Cable type" }, ["Copper Straight-Through", "Copper Cross-Over", "Console"].map((x) => h("option", null, x)));
      const actions = h("div", { class: "topo-actions" });
      const note = h("p", { class: "topo-note" });
      api.stage.append(h("div", null, topo.el, h("div", { class: "topo-actions" }, h("span", { class: "panel-k" }, "Cable:"), cable), actions, note));

      const terms = {
        PC0: Net.pcPrompt(net, "PC0", { pinged, after: () => api.refresh() }),
        PC1: Net.pcPrompt(net, "PC1", { pinged, after: () => api.refresh() }),
        SW: Net.ios(net, "SW", { after: () => api.refresh() }),
      };

      // ---------- Simulation panel
      const simBody = h("div", { class: "win-b" });
      const simPanel = Kit.win("Packet Tracer · Realtime / Simulation", "Event List", simBody);
      let stpTimer = null;
      function drawSim() {
        const visible = sim.events.filter((e) => sim.keep[e.proto]);
        const done = visible.filter((e) => e.seen).length;
        simBody.replaceChildren(
          h("div", { class: "seg" },
            h("button", { type: "button", "aria-pressed": !sim.on, onclick: () => setSim(false) }, "Realtime"),
            h("button", { type: "button", "aria-pressed": sim.on, onclick: () => setSim(true) }, "Simulation")),
          h("p", { class: "panel-k" }, "Edit Filters — show these protocols"),
          h("div", { class: "row" }, Object.keys(sim.keep).map((p) => h("label", { class: "pill", style: "display:inline-flex;gap:.35rem;align-items:center;padding:.3rem .5rem" },
            h("input", { type: "checkbox", checked: sim.keep[p], onchange: (e) => { sim.keep[p] = e.target.checked; drawSim(); api.refresh(); } }), p))),
          sim.on
            ? h("div", { class: "row" },
              h("button", { class: "btn btn--s", type: "button", disabled: done >= visible.length, onclick: forward }, "▶ Capture / Forward"),
              h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { sim.events = []; drawSim(); } }, "Reset Simulation"),
              h("small", null, `${done}/${visible.length} events`))
            : h("p", { class: "topo-note" }, "Switch to Simulation, keep only ARP and ICMP, then ping from PC0 and step with Capture / Forward."),
          h("div", { class: "list" }, visible.length ? visible.map((e, k) => h("div", { class: e.seen ? "" : k === done ? "sel" : "" },
            h("span", { class: "pill " + (e.proto === "ARP" ? "pill--warn" : e.proto === "ICMP" ? "pill--ok" : "") }, e.proto), " ",
            e.seen ? `${e.from} → ${e.to} · ${e.info}` : k === done ? "next: press Capture / Forward" : "…")) : h("div", null, sim.on ? "No events yet. Ping from PC0." : "Realtime mode: packets aren't recorded.")),
        );
      }
      function setSim(on) {
        sim.on = on;
        net.capture = on ? [] : null;
        net.anim = on ? null : (p, k) => topo.packet(p, k);
        clearInterval(stpTimer);
        if (on) stpTimer = setInterval(() => { // switches keep sending STP/CDP in the background
          const pc = ["PC0", "PC1"].find(linked);
          if (!pc) return;
          sim.events.push({ proto: Math.random() < 0.6 ? "STP" : "CDP", from: "Switch0", to: pc, info: Math.random() < 0.6 ? "BPDU (Spanning Tree)" : "CDP advertisement", path: ["SW", pc] });
          drawSim();
        }, 4000);
        drawSim(); api.refresh();
      }
      async function forward() {
        const visible = sim.events.filter((e) => sim.keep[e.proto]);
        const e = visible.find((x) => !x.seen);
        if (!e) return;
        e.seen = true;
        if (e.proto === "ARP") flag.simArp = sim.keep.ARP && sim.keep.ICMP && !sim.keep.STP && !sim.keep.CDP && !sim.keep.DNS ? true : flag.simArp;
        if (e.proto === "ICMP") flag.simIcmp = sim.keep.ARP && sim.keep.ICMP && !sim.keep.STP && !sim.keep.CDP && !sim.keep.DNS ? true : flag.simIcmp;
        drawSim();
        await topo.packet(e.path, e.proto.toLowerCase(), e.proto);
        api.refresh();
      }
      function harvest() { // copy new net events into the simulation list
        if (!net.capture) return;
        for (const ev of net.capture.splice(0)) {
          const name = (id) => (id === "SW" ? "Switch0" : id);
          sim.events.push({ proto: ev.proto, from: name(ev.path[0]), to: name(ev.path[ev.path.length - 1]), info: ev.info, path: ev.path });
        }
        drawSim();
      }

      // ---------- your Windows PC
      const win = Kit.shell({
        prompt: () => "C:\\Users\\student>", theme: "cmd", ci: true, label: "Windows command prompt", after: () => api.refresh(),
        banner: "Microsoft Windows [Version 10.0.22631.4317]\n(c) Microsoft Corporation. All rights reserved.",
        notFound: (c) => `'${c}' is not recognized as an internal or external command,\noperable program or batch file.`,
        commands: {
          hostname: (a, t) => { t.print("LAB-PC-07"); flag.win.add("hostname"); },
          ipconfig: (a, t) => {
            const all = (a[1] || "").toLowerCase() === "/all";
            t.lines(`\nWindows IP Configuration\n${all ? "\n   Host Name . . . . . . . . . . . . : LAB-PC-07\n   Node Type . . . . . . . . . . . . : Hybrid\n   IP Routing Enabled. . . . . . . . : No\n" : ""}\nWireless LAN adapter Wi-Fi:\n\n   Connection-specific DNS Suffix  . :\n${all ? "   Description . . . . . . . . . . . : Intel(R) Wi-Fi 6 AX201 160MHz\n   Physical Address. . . . . . . . . : 84-1B-77-3A-90-C2\n   DHCP Enabled. . . . . . . . . . . : Yes\n" : ""}   IPv4 Address. . . . . . . . . . . : 192.168.1.10${all ? "(Preferred)" : ""}\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.1.1${all ? "\n   DHCP Server . . . . . . . . . . . : 192.168.1.1\n   DNS Servers . . . . . . . . . . . : 192.168.1.1" : ""}\n\nEthernet adapter Ethernet:\n\n   Media State . . . . . . . . . . . : Media disconnected\n`);
            if (all) flag.win.add("ipconfig /all");
          },
          ping: async (a, t) => {
            const dst = a.find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
            if (!dst) return t.print("Usage: ping [-t] [-n count] target_name");
            const ok = dst.startsWith("127.") || dst === "192.168.1.10" || dst === "192.168.1.1" || dst === "192.168.1.20";
            t.print(""); t.print(`Pinging ${dst} with 32 bytes of data:`);
            for (let k = 0; k < 4; k++) {
              if (!(await t.wait(ok ? 250 : 900))) break;
              if (!dst.startsWith("127.")) { wsPkt("192.168.1.10", dst, "ICMP", `Echo (ping) request  id=0x0001, seq=${k + 1}/${(k + 1) * 256}, ttl=128`); if (ok) wsPkt(dst, "192.168.1.10", "ICMP", `Echo (ping) reply    id=0x0001, seq=${k + 1}/${(k + 1) * 256}, ttl=64`); }
              t.print(ok ? `Reply from ${dst}: bytes=32 time${dst.startsWith("127.") ? "<1" : "=3"}ms TTL=${dst.startsWith("127.") ? 128 : 64}` : "Request timed out.");
            }
            t.print(""); t.print(`Ping statistics for ${dst}:`); t.print(`    Packets: Sent = 4, Received = ${ok ? 4 : 0}, Lost = ${ok ? 0 : 4} (${ok ? 0 : 100}% loss),`);
            if (dst === "127.0.0.1") flag.win.add("ping 127.0.0.1");
          },
          arp: (a, t) => {
            if ((a[1] || "").toLowerCase() !== "-a") return t.print("ARP -a | -d | -s");
            t.lines(`\nInterface: 192.168.1.10 --- 0x12\n  Internet Address      Physical Address      Type\n  192.168.1.1           c4-6e-1f-22-09-b0     dynamic\n  192.168.1.20          9c-b6-d0-41-7e-13     dynamic\n  192.168.1.255         ff-ff-ff-ff-ff-ff     static\n  224.0.0.22            01-00-5e-00-00-16     static\n  239.255.255.250       01-00-5e-7f-ff-fa     static`);
            flag.win.add("arp -a");
          },
          netstat: (a, t) => {
            t.lines(`\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1180\n  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4\n  TCP    192.168.1.10:139       0.0.0.0:0              LISTENING       4\n  TCP    192.168.1.10:52144     142.250.185.78:443     ESTABLISHED     8812\n  TCP    192.168.1.10:52190     20.42.73.29:443        ESTABLISHED     5124\n  UDP    0.0.0.0:5353           *:*                                    8812`);
            if (a.map((x) => x.toLowerCase()).includes("-ano")) flag.win.add("netstat -ano");
          },
          cls: (a, t) => (t.out.textContent = ""),
        },
      });

      // ---------- Wireshark on your PC
      const ws = Kit.wireshark({
        ifaces: ["Ethernet", "Wi-Fi", "Adapter for loopback traffic capture"], okIface: (i) => i === "Wi-Fi",
        idle: "Pick the active interface (ipconfig shows which one has an address), then Start.",
        onStart: () => { flag.wsStarted = true; gen(); api.refresh(); }, onStop: () => { flag.wsStopped = flag.wsStarted; api.refresh(); },
        onFilter: (f, shown) => { const k = f.replace(/\s+/g, " ").trim().toLowerCase(); if (shown.length) flag.filters.add(k); api.refresh(); },
      });
      function wsPkt(src, dst, proto, info, extra = {}) {
        const layers = { ICMP: ["eth", "ip", "icmp"], DNS: ["eth", "ip", "udp", "dns"], TLS: ["eth", "ip", "tcp", "tls"], TCP: ["eth", "ip", "tcp"], SSDP: ["eth", "ip", "udp", "ssdp"], ARP: ["eth", "arp"] }[proto];
        ws.add({ src, dst, proto, info, len: proto === "ARP" ? 42 : proto === "DNS" ? 74 : 66, layers, f: proto === "ARP" ? {} : { "ip.src": src, "ip.dst": dst, "ip.addr": [src, dst] }, ...extra });
      }
      let genT = null;
      function gen() {
        clearTimeout(genT);
        if (!ws.running) return;
        const pool = [
          () => wsPkt("192.168.1.10", "192.168.1.1", "DNS", "Standard query 0x6b2a A www.mtu.edu.iq"),
          () => wsPkt("192.168.1.1", "192.168.1.10", "DNS", "Standard query response 0x6b2a A www.mtu.edu.iq A 185.84.236.10"),
          () => wsPkt("c4:6e:1f:22:09:b0", "Broadcast", "ARP", "Who has 192.168.1.10? Tell 192.168.1.1"),
          () => wsPkt("84:1b:77:3a:90:c2", "c4:6e:1f:22:09:b0", "ARP", "192.168.1.10 is at 84:1b:77:3a:90:c2"),
          () => wsPkt("192.168.1.10", "142.250.185.78", "TLS", "Application Data"),
          () => wsPkt("192.168.1.20", "192.168.1.10", "ICMP", "Echo (ping) request  id=0x0004, seq=17/4352, ttl=128"),
          () => wsPkt("192.168.1.10", "192.168.1.20", "ICMP", "Echo (ping) reply    id=0x0004, seq=17/4352, ttl=128"),
          () => wsPkt("192.168.1.10", "239.255.255.250", "SSDP", "M-SEARCH * HTTP/1.1"),
          () => wsPkt("192.168.1.25", "192.168.1.1", "DNS", "Standard query 0x11c0 A teams.microsoft.com"),
        ];
        pool[Math.floor(Math.random() * pool.length)]();
        genT = setTimeout(gen, 450 + Math.random() * 700);
      }

      api.termOf = (id) => terms[id] || (id === "win" ? win : null);
      api.stage.append(api.dock());
      api.device("PC0", "PC0", "Desktop", Net.pcPanel(net, "PC0", terms.PC0, () => api.refresh()));
      api.device("PC1", "PC1", "Desktop", Net.pcPanel(net, "PC1", terms.PC1, () => api.refresh()));
      api.device("sim", "Simulation", "Packet Tracer", simPanel);
      api.device("SW", "Switch0", "CLI (optional)", terms.SW.el);
      api.device("win", "Your PC", "Windows cmd", win.el);
      api.device("ws", "Wireshark", "Your PC", ws.el);
      api.onShow = (id) => topo.select(id);
      net.log = (id, text) => { terms[id]?.lines(text, "tl-log"); api.ping(id); };
      net.anim = (p, k) => topo.packet(p, k);
      let q = false;
      net.changed = () => { if (!q) { q = true; queueMicrotask(() => { q = false; draw(); api.refresh(); }); } };

      function pinged(pc, dst, rec) {
        harvest();
        const good = PC0.ip === "192.168.1.10" && PC1.ip === "192.168.1.20";
        if (good && pc.id === "PC0" && dst === "192.168.1.20" && rec > 0) { flag.p01 = true; if (flag.broke) flag.restored = true; }
        if (good && pc.id === "PC1" && dst === "192.168.1.10" && rec > 0) flag.p10 = true;
        if (pc.id === "PC0" && PC1.ip === "192.168.2.20" && (dst === "192.168.2.20" || dst === "192.168.1.20") && rec === 0) flag.broke = true;
        api.refresh();
      }
      function connect(pc) {
        if (cable.value !== "Copper Straight-Through") { api.toast(cable.value === "Console" ? "A console cable goes to the switch's console port, not FastEthernet." : "The link stays red: a PC to a switch needs a straight-through cable."); return; }
        net.link(pc, "FastEthernet0", "SW", PORT[pc]);
        api.toast(`${pc} Fa0 ↔ Switch0 ${PORT[pc].replace("FastEthernet", "Fa")}: link lights green`);
      }
      function draw() {
        topo.update((l) => (linked(l.a) ? "up" : "off"), (n) => (n.kind === "pc" && !linked(n.id) ? "off" : null));
        actions.replaceChildren(...["PC0", "PC1"].map((pc) => linked(pc)
          ? h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => net.unlink(pc) }, `Disconnect ${pc}`)
          : h("button", { class: "btn btn--s", type: "button", onclick: () => connect(pc) }, `Connect ${pc} → ${PORT[pc].replace("FastEthernet", "Fa")}`)));
        note.textContent = sim.on ? "Simulation Mode: pings are recorded as events; open the Simulation tab to step through them." : "Realtime Mode.";
      }
      draw(); drawSim();
    },
    diagnose() {
      if (!net.linkAt("PC0", "FastEthernet0") || !net.linkAt("PC1", "FastEthernet0")) return "Connect both PCs to the switch with Copper Straight-Through.";
      if (PC1.ip === "192.168.2.20") return "PC1 is in 192.168.2.0/24 and PC0 in 192.168.1.0/24. Without a router they can't talk. That's the point of the troubleshooting test.";
      return net.lastFail || "Looks fine.";
    },
    tasks: [
      { title: "Run the five basic Windows network commands", detail: "On your own PC: <code>hostname</code>, <code>ipconfig /all</code>, <code>ping 127.0.0.1</code>, <code>arp -a</code>, <code>netstat -ano</code>.", where: "Your PC › Windows cmd",
        answer: "hostname\nipconfig /all\nping 127.0.0.1\narp -a\nnetstat -ano", device: "win",
        type: () => ["hostname", "ipconfig /all", "ping 127.0.0.1", "arp -a", "netstat -ano"].find((c) => !flag.win.has(c)),
        check: () => flag.win.size >= 5 },
      { title: "Build the LAN: connect both PCs to Switch0", detail: "Use Copper Straight-Through cables. The links turn green.", where: "Cable buttons", hint: "PC to switch = different device types = straight-through.", check: () => linked("PC0") && linked("PC1") },
      { title: "Configure the IP addresses", detail: "PC0 192.168.1.10 /24, PC1 192.168.1.20 /24, gateway empty.", where: "PC0 / PC1 › IP Configuration",
        answer: "PC0: 192.168.1.10  255.255.255.0\nPC1: 192.168.1.20  255.255.255.0", check: () => PC0.ip === "192.168.1.10" && PC0.mask === "255.255.255.0" && PC1.ip === "192.168.1.20" && PC1.mask === "255.255.255.0" },
      { title: "Test connectivity both ways", where: "PC0 and PC1 › Command Prompt", answer: "PC0: ping 192.168.1.20\nPC1: ping 192.168.1.10",
        device: () => (flag.p01 ? "PC1" : "PC0"), type: () => (flag.p01 ? "ping 192.168.1.10" : "ping 192.168.1.20"), check: () => flag.p01 && flag.p10 },
      { title: "Switch to Simulation Mode and keep only ARP and ICMP", where: "Simulation tab", hint: "Untick STP, CDP and DNS in Edit Filters.", check: () => sim.on && sim.keep.ARP && sim.keep.ICMP && !sim.keep.STP && !sim.keep.CDP && !sim.keep.DNS },
      { title: "Watch ARP then ICMP, step by step", detail: "Ping from PC0, then press <b>Capture / Forward</b> to move each packet. You need to see at least one ARP and one ICMP event.", where: "PC0 + Simulation tab",
        hint: "PC0 already knows PC1's MAC from the earlier ping, so no ARP is sent. Clear its table first with <code>arp -d</code> on PC0, then ping.",
        answer: "PC0: arp -d\nPC0: ping 192.168.1.20\nSimulation: Capture / Forward (repeat)", device: "PC0", type: () => (Object.keys(PC0.arp).length ? "arp -d" : "ping 192.168.1.20"),
        check: () => flag.simArp && flag.simIcmp },
      { title: "Troubleshooting: put PC1 in another network", detail: "Change PC1 to 192.168.2.20 /24 and ping it from PC0. It must fail: different networks, no router.", where: "PC1 › IP Configuration, then PC0",
        hint: "Back to Realtime first if you like. Then ping 192.168.2.20 from PC0.", answer: "PC1 IPv4 Address: 192.168.2.20\nPC0: ping 192.168.2.20", device: "PC0", type: () => (PC1.ip === "192.168.2.20" ? "ping 192.168.2.20" : ""), check: () => flag.broke },
      { title: "Restore PC1 and test again", where: "PC1 › IP Configuration, then PC0", answer: "PC1 IPv4 Address: 192.168.1.20\nPC0: ping 192.168.1.20", device: "PC0", type: () => (PC1.ip === "192.168.1.20" ? "ping 192.168.1.20" : ""), check: () => flag.restored },
      { title: "Wireshark: capture on the active interface, then stop", where: "Wireshark tab", hint: "<code>ipconfig</code> showed the Ethernet adapter is disconnected; the active one is Wi-Fi.", check: () => flag.wsStarted && flag.wsStopped },
      { title: "Use the four display filters", detail: "<code>icmp</code>, <code>arp</code>, <code>dns</code> and <code>ip.addr == 192.168.1.10</code>.", where: "Wireshark tab",
        hint: "Type each filter and press Apply (or Enter). A green bar means valid syntax.", check: () => ["icmp", "arp", "dns", "ip.addr == 192.168.1.10"].every((f) => flag.filters.has(f)) },
    ],
    doneText: "You built and tested the LAN, watched ARP and ICMP hop by hop, broke and fixed addressing, and used Windows commands and Wireshark filters.",
    quiz: [
      { t: "mcq", q: "What is Cisco Packet Tracer used for?", opts: ["To create and simulate computer networks without physical equipment", "To capture real packets on a network card", "To scan networks for open ports", "To crack Wi-Fi passwords"], a: 0, src: "Lab 1 §12" },
      { t: "mcq", q: "Which protocol does ping use?", opts: ["ICMP", "ARP", "TCP", "DNS"], a: 0, src: "Lab 1 §8, §12" },
      { t: "mcq", q: "What is the purpose of ARP?", opts: ["To find the MAC address associated with an IPv4 address", "To assign IP addresses automatically", "To translate names to IP addresses", "To encrypt LAN traffic"], a: 0, src: "Lab 1 §8, §12" },
      { t: "tf", q: "A router is required for PC0 (192.168.1.10/24) to ping PC1 (192.168.1.20/24).", a: false, why: "Both are in 192.168.1.0/24, so the switch connects them directly.", src: "Lab 1 §6, §12" },
      { t: "match", q: "Match each Windows command to what it shows.", pairs: [["hostname", "The computer name"], ["ipconfig /all", "IP, mask, gateway and adapter details"], ["ping 127.0.0.1", "Tests the local TCP/IP stack (loopback)"], ["arp -a", "Known IP-to-MAC mappings"], ["netstat -ano", "Active connections and process IDs"]], src: "Lab 1 §4" },
      { t: "match", q: "Match each Wireshark display filter to what it shows.", pairs: [["icmp", "Ping packets"], ["arp", "ARP packets"], ["dns", "DNS packets"], ["ip.addr == 192.168.1.10", "Traffic related to PC0"]], src: "Lab 1 §10" },
      { t: "mcq", q: "Why may the very first ping fail?", opts: ["ARP is still learning the destination MAC address", "The switch needs a reboot", "ICMP is blocked by default", "The PCs need a default gateway"], a: 0, src: "Lab 1 §7" },
      { t: "fill", q: "Which cable type connects a PC to a switch in this lab? Copper ________-________", a: ["Straight-Through", "straight through", "straight-through"], src: "Lab 1 §5" },
      { t: "short", q: "PC1 is changed to 192.168.2.20/24. Why does the ping from PC0 fail?", model: "PC0 (192.168.1.0/24) and PC1 (192.168.2.0/24) are now in different IP networks. PC0 would need to send to a default gateway, but there is no router, so the packet can't be delivered.",
        keys: [["different network", "different networks", "different ip network", "different subnet"], ["router", "gateway"]], src: "Lab 1 §9" },
      { t: "order", q: "Order the Simulation Mode steps.", items: ["Select Simulation Mode", "Open Edit Filters and keep only ARP and ICMP", "Run ping from PC0 to PC1", "Use Capture/Forward to watch each packet"], src: "Lab 1 §8" },
      { t: "mcq", q: "Why is a switch used in this lab?", opts: ["To connect devices inside the same local area network", "To connect two different IP networks", "To assign IP addresses", "To encrypt traffic"], a: 0, src: "Lab 1 §12; Lecture 1 §1 device roles" },
      { t: "multi", q: "Which are rules for the laboratory? (Choose all that apply)", opts: ["Use tools only on laboratory systems and networks", "Do not scan, attack or access another device without permission", "Use security tools only for educational and authorised work", "Testing the university network is fine if it's for practice"], a: [0, 1, 2], src: "Lab 1 §3; Lecture 1 §9 (Ethical use)" },
      { t: "mcq", q: "Which element of the CIA triad does eavesdropping (sniffing) on unencrypted traffic mainly violate?", opts: ["Confidentiality", "Integrity", "Availability", "Accountability"], a: 0, src: "Lecture 1 §3 and §6 (passive attacks affect confidentiality)" },
      { t: "mcq", q: "Capturing traffic with Wireshark without changing it is an example of a…", opts: ["Passive activity (observes, doesn't modify)", "Active attack", "Denial of service", "Spoofing attack"], a: 0, src: "Lecture 1 §6" },
    ],
  });
})();
