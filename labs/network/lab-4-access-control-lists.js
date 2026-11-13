// Network Security · Experiment 4 — Configuring and Testing ACLs (Packet Tracer).
(() => {
  const { h } = Lab;
  const net = new Net.Network();
  const PC0 = net.pc("PC0", { name: "PC0", mac: "000A.41C2.7701", ip: "192.168.1.10", mask: "255.255.255.0", gw: "192.168.1.1" });
  const PC1 = net.pc("PC1", { name: "PC1", mac: "000A.41C2.7702", ip: "192.168.2.10", mask: "255.255.255.0", gw: "192.168.2.1" });
  net.switch("SW0", { mac: "0002.1111.0001" });
  net.switch("SW1", { mac: "0002.1111.0002" });
  const R1 = net.router("R1", { mac: "0030.F2A0.1100" });
  net.link("PC0", "FastEthernet0", "SW0", "FastEthernet0/1");
  net.link("SW0", "GigabitEthernet0/1", "R1", "GigabitEthernet0/0");
  net.link("R1", "GigabitEthernet0/1", "SW1", "GigabitEthernet0/1");
  net.link("SW1", "FastEthernet0/1", "PC1", "FastEthernet0");
  net.booting = false;
  const G0 = () => R1.ifaces["GigabitEthernet0/0"], G1 = () => R1.ifaces["GigabitEthernet0/1"];
  const acl = () => R1.acls[100];
  const flag = {};
  const aclOk = () => {
    const a = acl();
    if (!a || a.entries.length < 2) return false;
    const [d, p] = a.entries;
    return d.action === "deny" && d.proto === "icmp" && d.src.ip === "192.168.1.10" && d.src.wc === "0.0.0.0" && d.dst.ip === "192.168.2.10" && d.dst.wc === "0.0.0.0" && p.action === "permit" && p.proto === "ip" && p.src.any && p.dst.any;
  };

  Lab.start({
    brief: `
<p>Configure an <b>extended ACL</b> on R1 so PC0 (192.168.1.10) can no longer ping PC1 (192.168.2.10), while all other IP traffic is still allowed.</p>
<h3>Addressing</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Device</th><th>Interface</th><th>IP address</th><th>Gateway</th></tr>
<tr><td>PC0</td><td>Fa0</td><td>192.168.1.10/24</td><td>192.168.1.1</td></tr>
<tr><td>R1</td><td>G0/0</td><td>192.168.1.1/24</td><td>—</td></tr>
<tr><td>R1</td><td>G0/1</td><td>192.168.2.1/24</td><td>—</td></tr>
<tr><td>PC1</td><td>Fa0</td><td>192.168.2.10/24</td><td>192.168.2.1</td></tr></table></div>
<p>The PCs are already addressed. R1 is a factory-fresh Cisco 2911: its interfaces are shut down and have no addresses.</p>
<h3>How the ACL works</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Command</th><th>Purpose</th></tr>
<tr><td><code>deny icmp host 192.168.1.10 host 192.168.2.10</code></td><td>Blocks ping from PC0 to PC1</td></tr>
<tr><td><code>permit ip any any</code></td><td>Allows all other IP traffic</td></tr>
<tr><td><code>ip access-group 100 in</code></td><td>Applies ACL 100 to packets entering R1 from the PC0 side</td></tr></table></div>
<p class="key"><b>Remember (Lecture 3):</b> rules are checked in order, the first match wins, and every ACL ends with an invisible <i>deny any</i>.</p>`,
    setup(api) {
      const topo = new api.Topo({
        w: 380, h: 190, label: "PC0, Switch0, R1, Switch1, PC1",
        nodes: [
          { id: "PC0", kind: "pc", label: "PC0", sub: ".1.10", x: 34, y: 120 },
          { id: "SW0", kind: "switch", label: "Switch0", x: 110, y: 60 },
          { id: "R1", kind: "router", label: "R1", sub: "2911", x: 190, y: 120 },
          { id: "SW1", kind: "switch", label: "Switch1", x: 270, y: 60 },
          { id: "PC1", kind: "pc", label: "PC1", sub: ".2.10", x: 346, y: 120 },
        ],
        links: [{ a: "PC0", b: "SW0" }, { a: "SW0", b: "R1", bl: "G0/0" }, { a: "R1", b: "SW1", al: "G0/1" }, { a: "SW1", b: "PC1" }],
        onClick: (id) => (id.startsWith("SW") ? api.toast("The switches need no configuration in this lab.") : api.show(id)),
      });
      const note = h("p", { class: "topo-note" });
      api.stage.append(h("div", null, topo.el, note));
      const terms = {
        R1: Net.ios(net, "R1", { after: (l) => afterR(l) }),
        PC0: Net.pcPrompt(net, "PC0", { pinged: pinged, after: () => api.refresh() }),
        PC1: Net.pcPrompt(net, "PC1", { pinged: pinged, after: () => api.refresh() }),
      };
      api.termOf = (id) => terms[id];
      api.stage.append(api.dock());
      api.device("R1", "R1", "Router · CLI", terms.R1.el);
      api.device("PC0", "PC0", "Desktop", Net.pcPanel(net, "PC0", terms.PC0, () => api.refresh()));
      api.device("PC1", "PC1", "Desktop", Net.pcPanel(net, "PC1", terms.PC1, () => api.refresh()));
      api.onShow = (id) => topo.select(id);
      topo.select("R1");
      net.log = (id, text) => { terms[id]?.lines(text, "tl-log"); api.ping(id); };
      net.anim = (path, kind) => topo.packet(path, kind);
      let q = false;
      net.changed = () => { if (!q) { q = true; queueMicrotask(() => { q = false; draw(); api.refresh(); }); } };

      function pinged(pc, dst, rec) {
        const applied = G0().aclIn === 100 && aclOk();
        if (pc.id === "PC0" && dst === "192.168.2.10") {
          if (!applied && G0().aclIn == null && rec > 0) { flag.before = true; if (flag.removed) flag.after = true; }
          if (applied && rec === 0) flag.blocked = true;
        }
        if (pc.id === "PC0" && dst === "192.168.2.1" && applied && rec > 0) flag.otherOk = true;
        api.refresh();
      }
      function afterR(line) {
        if (/^\s*(do\s+)?sh\w*\s+access-l\w*/i.test(line) && aclOk()) flag.shown = true;
        if (/^\s*(do\s+)?sh\w*\s+ip\s+int\w*\s+g\w*\s*0\/0\s*$/i.test(line) && G0().aclIn === 100) flag.shownIf = true;
        if (flag.blocked && G0().aclIn == null) flag.removed = true;
        api.refresh();
      }
      function draw() {
        topo.update((l) => (net.linkUp(net.links.find((x) => (x.a === l.a && x.b === l.b) || (x.a === l.b && x.b === l.a))) ? "up" : "down"),
          (n) => (n.id === "R1" && G0().aclIn != null ? "ok" : null));
        note.textContent = G0().aclIn != null ? `ACL ${G0().aclIn} applied inbound on R1 G0/0 (green frame).` : "No ACL applied yet. Red dashed links are down (router interfaces start shut down).";
      }
      draw();
    },
    diagnose() {
      if (!G0().ip || !G1().ip) return "R1 still needs IP addresses on G0/0 and G0/1.";
      if (G0().shutdown || G1().shutdown) return "An R1 interface is still shut down: enter the interface and type <code>no shutdown</code>.";
      if (acl() && !acl().entries.some((e) => e.action === "permit")) return "ACL 100 has no permit line, so the implicit <b>deny any</b> at the end blocks everything. Add <code>access-list 100 permit ip any any</code>.";
      return net.lastFail || "No problem found. If a ping just failed once, the router was resolving ARP: ping again.";
    },
    tasks: [
      { title: "Configure R1's interfaces", detail: "G0/0 = 192.168.1.1/24, G0/1 = 192.168.2.1/24, both <code>no shutdown</code>.", where: "R1 › CLI",
        hint: "Interfaces on a router are shut down by default; each needs an address and no shutdown.",
        answer: "enable\nconfigure terminal\nhostname R1\ninterface gigabitEthernet 0/0\n ip address 192.168.1.1 255.255.255.0\n no shutdown\nexit\ninterface gigabitEthernet 0/1\n ip address 192.168.2.1 255.255.255.0\n no shutdown\nexit\nend",
        device: "R1", type: () => Net.nextRouter(R1, { hostname: "R1", ifs: [["GigabitEthernet0/0", "192.168.1.1", "255.255.255.0"], ["GigabitEthernet0/1", "192.168.2.1", "255.255.255.0"]] }),
        check: () => G0().ip === "192.168.1.1" && G0().mask === "255.255.255.0" && !G0().shutdown && G1().ip === "192.168.2.1" && G1().mask === "255.255.255.0" && !G1().shutdown },
      { title: "Test before the ACL: PC0 pings PC1", detail: "It should succeed. If the first reply times out, the router was resolving ARP.", where: "PC0 › Command Prompt",
        answer: "ping 192.168.2.10", device: "PC0", type: "ping 192.168.2.10", check: () => flag.before },
      { title: "Create ACL 100", detail: "Deny ICMP from host PC0 to host PC1, then permit all other IP traffic.", where: "R1 › CLI (global config)",
        hint: "Extended ACLs are numbered 100–199. Order matters: the deny must come first.",
        answer: "configure terminal\naccess-list 100 deny icmp host 192.168.1.10 host 192.168.2.10\naccess-list 100 permit ip any any",
        device: "R1", type: () => (R1.mode === "user" ? "enable" : R1.mode === "priv" ? "configure terminal" : !acl() ? "access-list 100 deny icmp host 192.168.1.10 host 192.168.2.10" : "access-list 100 permit ip any any"),
        check: () => aclOk() },
      { title: "Apply ACL 100 inbound on G0/0 and save", detail: "Inbound on the interface that faces PC0, then <code>write memory</code>.", where: "R1 › CLI",
        hint: "Place it where PC0's packets enter the router.", answer: "interface gigabitEthernet 0/0\n ip access-group 100 in\nend\nwrite memory",
        device: "R1", type: () => (R1.mode === "user" ? "enable" : R1.mode === "priv" ? (G0().aclIn === 100 ? "write memory" : "configure terminal") : G0().aclIn === 100 ? "end" : R1.mode === "if" && R1.cur === "GigabitEthernet0/0" ? "ip access-group 100 in" : "interface gigabitEthernet 0/0"),
        check: () => G0().aclIn === 100 && aclOk() && R1.startup?.ifaces["GigabitEthernet0/0"].aclIn === 100 },
      { title: "Test after the ACL: the ping must fail", detail: "Expected: <b>Request timed out.</b>", where: "PC0 › Command Prompt", answer: "ping 192.168.2.10", device: "PC0", type: "ping 192.168.2.10", check: () => flag.blocked },
      { title: "Prove other traffic still passes", detail: "Ping R1's G0/1 (192.168.2.1) from PC0. It works because only PC0 → PC1 ICMP matches the deny.", where: "PC0 › Command Prompt",
        hint: "permit ip any any lets everything else through.", answer: "ping 192.168.2.1", device: "PC0", type: "ping 192.168.2.1", check: () => flag.otherOk },
      { title: "Verify the ACL and where it is applied", detail: "Look for the match counters, and for “Inbound access list is 100”.", where: "R1 › CLI",
        answer: "show access-lists\nshow ip interface gigabitEthernet 0/0", device: "R1", type: () => (flag.shown ? "show ip interface gigabitEthernet 0/0" : "show access-lists"),
        check: () => flag.shown && flag.shownIf },
      { title: "Remove the ACL and ping again", detail: "Removing the access-group from the interface restores the ping.", where: "R1 › CLI, then PC0",
        answer: "configure terminal\ninterface gigabitEthernet 0/0\n no ip access-group 100 in\nend\n(then on PC0) ping 192.168.2.10",
        device: () => (G0().aclIn == null && (R1.mode === "priv" || R1.mode === "user") ? "PC0" : "R1"),
        type: () => (G0().aclIn == null ? (R1.mode === "priv" || R1.mode === "user" ? "ping 192.168.2.10" : "end") : R1.mode === "user" ? "enable" : R1.mode === "priv" ? "configure terminal" : R1.mode === "if" && R1.cur === "GigabitEthernet0/0" ? "no ip access-group 100 in" : "interface gigabitEthernet 0/0"),
        check: () => flag.after },
    ],
    doneText: "Before the ACL the ping worked, ACL 100 blocked only PC0 → PC1 ICMP, and removing it restored the ping: the expected result of Experiment 4.",
    quiz: [
      { t: "mcq", q: "What is the purpose of an ACL?", opts: ["It controls which network traffic is permitted or denied", "It assigns IP addresses to hosts", "It encrypts traffic between routers", "It translates private addresses to public ones"], a: 0, src: "Lab 4 §15 Q1; Lecture 3 §5" },
      { t: "cmd", q: "Which interface command applies ACL 100 to packets entering the interface?", a: "ip access-group 100 in", src: "Lab 4 §7, §15 Q3" },
      { t: "mcq", q: "Why does ACL 100 end with <code>permit ip any any</code>?", opts: ["To allow all other IP traffic; without it the implicit deny would block everything", "To allow only ICMP", "To log every packet", "Because extended ACLs must end with a permit to be valid syntax"], a: 0, src: "Lab 4 §8, §14, §15 Q4" },
      { t: "fill", q: "After the ACL is applied, the ping from PC0 to PC1 shows: <b>Request ______ ___.</b>", a: ["timed out", "timed out."], src: "Lab 4 §9, §15 Q5" },
      { t: "tf", q: "In this lab, ACL 100 also blocks PC0 from pinging R1's G0/1 address (192.168.2.1).", a: false, why: "The deny only matches ICMP from host 192.168.1.10 to host 192.168.2.10. Everything else matches permit ip any any.", src: "Lab 4 §8" },
      { t: "mcq", q: "Ping still works after you configured the ACL. Per the troubleshooting table, what do you check?", opts: ["The ACL direction and interface: G0/0 inbound", "The PC's DNS server", "The switch VLANs", "The router's hostname"], a: 0, src: "Lab 4 §14" },
      { t: "order", q: "Order the lab procedure.", items: ["Configure IP addresses on PCs and R1", "Verify ping works before the ACL", "Create ACL 100", "Apply ACL 100 inbound on R1 G0/0", "Verify the ping from PC0 to PC1 fails", "Display the ACL with show access-lists", "Remove the ACL and verify ping works again"], src: "Lab 4 §12" },
      { t: "match", q: "Match each part of <code>access-list 100 deny icmp host 192.168.1.10 host 192.168.2.10</code>.", pairs: [["100", "Extended ACL number"], ["deny", "Action"], ["icmp", "Protocol"], ["host 192.168.1.10", "Source"], ["host 192.168.2.10", "Destination"]], src: "Lab 4 §7; Lecture 3 §5" },
      { t: "mcq", q: "What is the main difference between a standard and an extended ACL?", opts: ["Standard checks mainly the source IPv4 address; extended can check source, destination, protocol and port", "Standard ACLs are faster because they check ports", "Extended ACLs only work on switches", "There is no difference except the number"], a: 0, src: "Lecture 3 §5 (Standard vs Extended ACL)" },
      { t: "multi", q: "Which statements about ACL processing are true? (Choose all that apply)", opts: ["Rules are checked in order", "The first matching rule is applied", "Specific rules should normally appear before general rules", "All matching rules are combined", "If no rule matches, the packet is permitted"], a: [0, 1, 2], why: "If nothing matches, the implicit deny drops the packet.", src: "Lecture 3 §5 (ACL Processing Principles)" },
      { t: "cmd", q: "Which command shows which ACL is applied, and in which direction, on G0/0?", a: ["show ip interface gigabitEthernet 0/0", "show ip interface g0/0"], src: "Lab 4 §10" },
      { t: "short", q: "Why is the deny line written before <code>permit ip any any</code>? What happens if you reverse them?", model: "ACL lines are checked top to bottom and the first match wins. If <code>permit ip any any</code> came first, every packet (including PC0's ping) would match it and be permitted, so the deny would never be reached.",
        keys: [["order", "top to bottom", "in order"], ["first match", "first matching"], ["permit", "allowed"], ["never", "not reached", "no effect"]], src: "Lecture 3 §5" },
      { t: "mcq", q: "A packet from the Internet arrives claiming an internal source address. Which Lecture 3 controls address this?", opts: ["Ingress filtering and uRPF", "Port security", "BPDU Guard", "Sticky MAC"], a: 0, src: "Lecture 3 §5 anti-spoofing and case study" },
    ],
  });
})();
