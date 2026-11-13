// Network Security · Experiment 3 — Site-to-Site IPsec VPN (Packet Tracer).
(() => {
  const { h } = Lab;
  const net = new Net.Network();
  net.pc("A", { name: "PC-A", mac: "00E0.F7A1.0A01", ip: "192.168.1.10", mask: "255.255.255.0", gw: "192.168.1.1" });
  net.pc("B", { name: "PC-B", mac: "00E0.F7A1.0B01", ip: "192.168.2.10", mask: "255.255.255.0", gw: "192.168.2.1" });
  net.switch("S1", { mac: "0002.2222.0001" });
  net.switch("S2", { mac: "0002.2222.0002" });
  const R1 = net.router("R1", { mac: "0030.A3B4.0100" });
  const R2 = net.router("R2", { mac: "0030.A3B4.0200" });
  net.link("A", "FastEthernet0", "S1", "FastEthernet0/1");
  net.link("S1", "GigabitEthernet0/1", "R1", "GigabitEthernet0/0");
  net.link("R1", "GigabitEthernet0/1", "R2", "GigabitEthernet0/1");
  net.link("R2", "GigabitEthernet0/0", "S2", "GigabitEthernet0/1");
  net.link("S2", "FastEthernet0/1", "B", "FastEthernet0");
  net.booting = false;
  const flag = {};
  const I = (r, n) => r.ifaces["GigabitEthernet0/" + n];
  const basic = (r, lan, wan, route, nh) => I(r, 0).ip === lan && I(r, 0).mask === "255.255.255.0" && !I(r, 0).shutdown && I(r, 1).ip === wan && I(r, 1).mask === "255.255.255.252" && !I(r, 1).shutdown && r.routes.some((x) => x.net === route && x.mask === "255.255.255.0" && x.nh === nh);
  function vpnOk(r, peer, src, dst) {
    const pol = Object.values(r.isakmp).some((p) => p.auth === "pre-share");
    const a = r.acls[110]?.entries.some((e) => e.action === "permit" && e.proto === "ip" && e.src.ip === src && e.src.wc === "0.0.0.255" && e.dst.ip === dst && e.dst.wc === "0.0.0.255");
    const ent = Object.values(r.cmaps["VPN-MAP"] || {})[0];
    return pol && a && r.keys[peer] && r.tsets["VPN-SET"] && ent && ent.peer === peer && ent.ts === "VPN-SET" && ent.acl === 110 && I(r, 1).cmap === "VPN-MAP";
  }
  const vpnCmds = (peer, src, dst) => `configure terminal\naccess-list 110 permit ip ${src} 0.0.0.255 ${dst} 0.0.0.255\ncrypto isakmp policy 10\n encryption aes 256\n hash sha\n authentication pre-share\n group 5\nexit\ncrypto isakmp key vpn123 address ${peer}\ncrypto ipsec transform-set VPN-SET esp-aes esp-sha-hmac\ncrypto map VPN-MAP 10 ipsec-isakmp\n set peer ${peer}\n set transform-set VPN-SET\n match address 110\nexit\ninterface g0/1\n crypto map VPN-MAP\nend`;
  // the next command a student still needs for the VPN, for "Type it for me"
  function nextVpn(r, peer, src, dst) {
    if (r.mode === "user") return "enable";
    if (r.mode === "priv") return vpnOk(r, peer, src, dst) ? "show crypto map" : "configure terminal";
    const p = r.isakmp[10];
    if (r.mode === "isakmp") return p.enc !== "aes 256" ? "encryption aes 256" : p.hash !== "sha" ? "hash sha" : p.auth !== "pre-share" ? "authentication pre-share" : p.group !== 5 ? "group 5" : "exit";
    const e = r.cmaps["VPN-MAP"]?.[10];
    if (r.mode === "cmap") return !e.peer ? "set peer " + peer : !e.ts ? "set transform-set VPN-SET" : e.acl == null ? "match address 110" : "exit";
    if (!r.acls[110]) return `access-list 110 permit ip ${src} 0.0.0.255 ${dst} 0.0.0.255`;
    if (!p || p.auth !== "pre-share" || p.enc !== "aes 256" || p.group !== 5) return "crypto isakmp policy 10";
    if (!r.keys[peer]) return "crypto isakmp key vpn123 address " + peer;
    if (!r.tsets["VPN-SET"]) return "crypto ipsec transform-set VPN-SET esp-aes esp-sha-hmac";
    if (!e || !e.peer || !e.ts || e.acl == null) return "crypto map VPN-MAP 10 ipsec-isakmp";
    if (r.mode === "if" && r.cur === "GigabitEthernet0/1") return I(r, 1).cmap ? "end" : "crypto map VPN-MAP";
    return I(r, 1).cmap ? "end" : "interface g0/1";
  }
  const basicCmds = (name, lan, wan, route, nh) => `enable\nconfigure terminal\nhostname ${name}\ninterface g0/0\n ip address ${lan} 255.255.255.0\n no shutdown\nexit\ninterface g0/1\n ip address ${wan} 255.255.255.252\n no shutdown\nexit\nip route ${route} 255.255.255.0 ${nh}\nend`;

  Lab.start({
    brief: `
<p>Build two LANs and protect the traffic between them with a <b>site-to-site IPsec VPN</b> between R1 and R2, then generate traffic and verify that it is encrypted.</p>
<p class="key"><b>Key idea:</b> the routers encrypt and decrypt; the PCs send normal IP traffic. IPsec provides confidentiality, integrity and authentication.</p>
<h3>Addressing</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Device / interface</th><th>IP address</th><th>Mask</th><th>Gateway</th></tr>
<tr><td>PC-A</td><td>192.168.1.10</td><td>255.255.255.0</td><td>192.168.1.1</td></tr>
<tr><td>R1 G0/0</td><td>192.168.1.1</td><td>255.255.255.0</td><td>—</td></tr>
<tr><td>R1 G0/1</td><td>10.0.0.1</td><td>255.255.255.252</td><td>—</td></tr>
<tr><td>R2 G0/1</td><td>10.0.0.2</td><td>255.255.255.252</td><td>—</td></tr>
<tr><td>R2 G0/0</td><td>192.168.2.1</td><td>255.255.255.0</td><td>—</td></tr>
<tr><td>PC-B</td><td>192.168.2.10</td><td>255.255.255.0</td><td>192.168.2.1</td></tr></table></div>
<p>The PCs are already addressed. Both routers are factory-fresh Cisco 2911s <b>without the security license</b>, so the <code>crypto</code> commands don't exist until you enable it (the setup step at the end of the handout).</p>
<h3>VPN steps</h3>
<ol><li>Interesting-traffic ACL (110)</li><li>IKE phase 1: <code>crypto isakmp policy</code> + pre-shared key</li><li>IPsec transform set</li><li>Crypto map (peer, transform set, ACL)</li><li>Apply the crypto map to the WAN interface G0/1</li></ol>
<p class="note">Do not configure IPsec until the basic ping between the two LANs works.</p>`,
    setup(api) {
      const topo = new api.Topo({
        w: 420, h: 190, label: "PC-A, S1, R1, R2, S2, PC-B",
        nodes: [
          { id: "A", kind: "pc", label: "PC-A", sub: "192.168.1.10", x: 32, y: 125 },
          { id: "S1", kind: "switch", label: "S1", x: 100, y: 60 },
          { id: "R1", kind: "router", label: "R1", sub: "10.0.0.1", x: 170, y: 125 },
          { id: "R2", kind: "router", label: "R2", sub: "10.0.0.2", x: 250, y: 125 },
          { id: "S2", kind: "switch", label: "S2", x: 320, y: 60 },
          { id: "B", kind: "pc", label: "PC-B", sub: "192.168.2.10", x: 388, y: 125 },
        ],
        links: [{ a: "A", b: "S1" }, { a: "S1", b: "R1", bl: "G0/0" }, { a: "R1", b: "R2", al: "G0/1", bl: "G0/1" }, { a: "R2", b: "S2", al: "G0/0" }, { a: "S2", b: "B" }],
        onClick: (id) => (id.startsWith("S") ? api.toast("The switches need no configuration in this lab.") : api.show(id)),
      });
      const note = h("p", { class: "topo-note" });
      api.stage.append(h("div", null, topo.el, note));
      const terms = {
        R1: Net.ios(net, "R1", { after: (l) => afterR(R1, l) }),
        R2: Net.ios(net, "R2", { after: (l) => afterR(R2, l) }),
        A: Net.pcPrompt(net, "A", { pinged, after: () => api.refresh() }),
        B: Net.pcPrompt(net, "B", { pinged, after: () => api.refresh() }),
      };
      api.termOf = (id) => terms[id];
      api.stage.append(api.dock());
      api.device("R1", "R1", "Router · CLI", terms.R1.el);
      api.device("R2", "R2", "Router · CLI", terms.R2.el);
      api.device("A", "PC-A", "Desktop", Net.pcPanel(net, "A", terms.A, () => api.refresh()));
      api.device("B", "PC-B", "Desktop", Net.pcPanel(net, "B", terms.B, () => api.refresh()));
      api.onShow = (id) => topo.select(id);
      topo.select("R1");
      net.log = (id, text) => { terms[id]?.lines(text, "tl-log"); api.ping(id); };
      net.anim = (path, kind) => {
        // colour the R1–R2 hop purple once the tunnel exists
        const tunnel = R1.sa["10.0.0.2"] && path.includes("R1") && path.includes("R2");
        return topo.packet(path, tunnel ? "esp" : kind, tunnel ? "ESP" : "");
      };
      let q = false;
      net.changed = () => { if (!q) { q = true; queueMicrotask(() => { q = false; draw(); api.refresh(); }); } };
      function pinged(pc, dst, rec) {
        if (pc.id === "A" && dst === "192.168.2.10" && rec > 0) {
          if (!I(R1, 1).cmap) flag.basicPing = true;
          if (R1.sa["10.0.0.2"]?.encaps > 0) flag.vpnPing = true;
        }
        api.refresh();
      }
      function afterR(r, line) {
        if (r === R1 && /^\s*(do\s+)?sh\w*\s+cry\w*\s+isa\w*\s+sa\s*$/i.test(line) && R1.sa["10.0.0.2"]) flag.isakmp = true;
        if (r === R1 && /^\s*(do\s+)?sh\w*\s+cry\w*\s+ipsec\s+sa\s*$/i.test(line) && R1.sa["10.0.0.2"]?.encaps > 0 && R1.sa["10.0.0.2"]?.decaps > 0) flag.ipsec = true;
        api.refresh();
      }
      function draw() {
        topo.update((l) => (net.linkUp(net.links.find((x) => (x.a === l.a && x.b === l.b) || (x.a === l.b && x.b === l.a))) ? "up" : "down"),
          (n) => (n.kind === "router" ? (Object.keys(net.dev[n.id].sa).length ? "ok" : null) : null));
        note.textContent = R1.sa["10.0.0.2"] ? "Tunnel up: R1 ↔ R2 have IPsec security associations (green frames). Traffic between the LANs crosses the WAN as ESP (purple)." : `Security license — R1: ${R1.license ? "securityk9 ✓" : R1.licNext ? "after reload" : "none"} · R2: ${R2.license ? "securityk9 ✓" : R2.licNext ? "after reload" : "none"}`;
      }
      draw();
    },
    diagnose() {
      for (const r of [R1, R2]) if (!r.license) return `${r.hostname} has no security license yet: <code>license boot level securityk9</code>, answer yes, then <code>end</code>, <code>write</code>, <code>reload</code>.`;
      return net.lastFail || "No fault found. If you just applied the crypto maps, the first ping negotiates the tunnel: ping again.";
    },
    tasks: [
      { title: "Enable the security license on R1 and R2", detail: "Without securityk9 the routers don't know the <code>crypto</code> commands. Do this on both routers.", where: "R1 and R2 › CLI",
        hint: "Accept the licence with yes, save with write, then reload so it takes effect at boot.",
        answer: "en\nconf t\nlicense boot level securityk9\n(ACCEPT? yes)\nend\nwrite\nreload\n(press Enter to confirm)",
        device: () => (R1.license ? "R2" : "R1"),
        type: () => { const r = R1.license ? R2 : R1; const saved = !!r.startup?.licNext; return r.mode === "user" ? "enable" : r.mode === "priv" ? (!r.licNext ? "configure terminal" : saved ? "reload" : "write") : r.licNext ? "end" : "license boot level securityk9"; },
        check: () => R1.license && R2.license },
      { title: "Basic configuration of R1", detail: "Addresses on G0/0 and G0/1, no shutdown, and a static route to 192.168.2.0/24 via 10.0.0.2.", where: "R1 › CLI",
        answer: basicCmds("R1", "192.168.1.1", "10.0.0.1", "192.168.2.0", "10.0.0.2"), device: "R1",
        type: () => Net.nextRouter(R1, { hostname: "R1", ifs: [["GigabitEthernet0/0", "192.168.1.1", "255.255.255.0"], ["GigabitEthernet0/1", "10.0.0.1", "255.255.255.252"]], routes: [["192.168.2.0", "255.255.255.0", "10.0.0.2"]] }),
        check: () => basic(R1, "192.168.1.1", "10.0.0.1", "192.168.2.0", "10.0.0.2") },
      { title: "Basic configuration of R2", detail: "The mirror image: 192.168.2.1/24 and 10.0.0.2/30, route to 192.168.1.0/24 via 10.0.0.1.", where: "R2 › CLI",
        answer: basicCmds("R2", "192.168.2.1", "10.0.0.2", "192.168.1.0", "10.0.0.1"), device: "R2",
        type: () => Net.nextRouter(R2, { hostname: "R2", ifs: [["GigabitEthernet0/0", "192.168.2.1", "255.255.255.0"], ["GigabitEthernet0/1", "10.0.0.2", "255.255.255.252"]], routes: [["192.168.1.0", "255.255.255.0", "10.0.0.1"]] }),
        check: () => basic(R2, "192.168.2.1", "10.0.0.2", "192.168.1.0", "10.0.0.1") },
      { title: "Test before the VPN: PC-A pings PC-B", detail: "Must succeed before you configure IPsec. A first timeout is normal: the routers resolve ARP.", where: "PC-A › Command Prompt",
        answer: "ping 192.168.2.10", device: "A", type: "ping 192.168.2.10", check: () => flag.basicPing },
      { title: "Configure the VPN on R1", detail: "ACL 110 → ISAKMP policy 10 → key → transform set → crypto map → apply on G0/1.", where: "R1 › CLI",
        hint: "Interesting traffic on R1 is 192.168.1.0/24 → 192.168.2.0/24. The peer is R2's WAN address 10.0.0.2.",
        answer: vpnCmds("10.0.0.2", "192.168.1.0", "192.168.2.0"), device: "R1", type: () => nextVpn(R1, "10.0.0.2", "192.168.1.0", "192.168.2.0"),
        check: () => vpnOk(R1, "10.0.0.2", "192.168.1.0", "192.168.2.0") },
      { title: "Configure the matching VPN on R2", detail: "Same policy, same key, same transform set, and a <b>mirror-image</b> ACL.", where: "R2 › CLI",
        hint: "On R2 the interesting traffic is 192.168.2.0/24 → 192.168.1.0/24, and the peer is 10.0.0.1.",
        answer: vpnCmds("10.0.0.1", "192.168.2.0", "192.168.1.0"), device: "R2", type: () => nextVpn(R2, "10.0.0.1", "192.168.2.0", "192.168.1.0"),
        check: () => vpnOk(R2, "10.0.0.1", "192.168.2.0", "192.168.1.0") },
      { title: "Bring the tunnel up with traffic", detail: "Ping PC-B from PC-A. If the first ping fails, repeat it: the routers negotiate IKE first.", where: "PC-A › Command Prompt",
        answer: "ping 192.168.2.10", device: "A", type: "ping 192.168.2.10", check: () => flag.vpnPing },
      { title: "Verify IKE phase 1 on R1", detail: "Expect state <b>QM_IDLE</b>, status ACTIVE.", where: "R1 › CLI", answer: "show crypto isakmp sa", device: "R1", type: "show crypto isakmp sa", check: () => flag.isakmp },
      { title: "Verify the IPsec counters on R1", detail: "#pkts encaps/encrypt and #pkts decaps/decrypt must be greater than 0.", where: "R1 › CLI", answer: "show crypto ipsec sa", device: "R1", type: "show crypto ipsec sa", check: () => flag.ipsec },
    ],
    doneText: "Both LANs talk through an encrypted IPsec tunnel, and you proved it with show crypto isakmp sa and the encaps/decaps counters.",
    quiz: [
      { t: "mcq", q: "What is the purpose of a site-to-site VPN?", opts: ["To securely connect two different LANs through an untrusted network", "To give one remote user access to a single server", "To replace routing between two LANs", "To filter ICMP between two hosts"], a: 0, src: "Lab 3 §10 Q1" },
      { t: "mcq", q: "Which devices encrypt the traffic in this lab?", opts: ["R1 and R2", "PC-A and PC-B", "S1 and S2", "All six devices"], a: 0, why: "The routers perform encryption/decryption; the PCs send normal IP traffic.", src: "Lab 3 §2, §10 Q2" },
      { t: "fill", q: "Traffic selected by the crypto ACL for IPsec protection is called ________ traffic.", a: ["interesting"], src: "Lab 3 §10 Q3" },
      { t: "cmd", q: "Which command verifies IKE phase 1?", a: "show crypto isakmp sa", src: "Lab 3 §7, §10 Q4" },
      { t: "cmd", q: "Which command shows the encrypted/decrypted packet counters?", a: "show crypto ipsec sa", src: "Lab 3 §7, §10 Q5" },
      { t: "order", q: "Put the IPsec configuration steps in order.", items: ["Interesting-traffic ACL", "IKE phase 1 (ISAKMP policy and pre-shared key)", "IPsec transform set", "Crypto map", "Apply the crypto map to the WAN interface"], src: "Lab 3 §6" },
      { t: "multi", q: "The VPN does not start. Which causes does the handout list? (Choose all that apply)", opts: ["The ACLs are not mirror images", "Different pre-shared keys on R1 and R2", "The crypto map is not applied on G0/1 of both routers", "The PCs have no DNS server", "The switches are not configured"], a: [0, 1, 2], src: "Lab 3 §8" },
      { t: "fill", q: "<code>show crypto isakmp sa</code> should show the state <b>________</b> when the tunnel is up.", a: ["QM_IDLE", "qm idle"], src: "Lab 3 §7 table" },
      { t: "mcq", q: "R1 G0/1 uses mask 255.255.255.252. How many usable host addresses does that WAN link have?", opts: ["2", "4", "6", "254"], a: 0, why: "/30 = 4 addresses: network, 2 hosts, broadcast. Exactly what a point-to-point link needs.", src: "Lab 3 §3 addressing table" },
      { t: "tf", q: "AH provides confidentiality by encrypting the payload.", a: false, why: "AH gives integrity, data-origin authentication and anti-replay but no confidentiality. ESP can encrypt.", src: "Lecture 3 §6 (AH vs ESP)" },
      { t: "mcq", q: "Which IPsec mode is typical for a link between two sites (gateway-to-gateway)?", opts: ["Tunnel mode: a new outer IP header is added and the whole original packet is protected", "Transport mode: the original header stays visible", "Neither; site-to-site uses AH only", "Promiscuous mode"], a: 0, src: "Lecture 3 §7" },
      { t: "match", q: "Match the IPsec component to its role.", pairs: [["AH", "Integrity and authentication, no encryption"], ["ESP", "Encryption plus integrity and authentication"], ["SA", "One-directional agreement: algorithms, keys, peer, lifetime"], ["IKEv2", "Authenticates peers, negotiates and creates SAs"]], src: "Lecture 3 §6, §8" },
      { t: "short", q: "Why does the handout say not to configure IPsec until the basic ping between the two LANs works?", model: "IPsec runs on top of normal routing. If addressing, interfaces or static routes are wrong, the tunnel can't form and you can't tell whether the fault is routing or the VPN. Proving basic connectivity first isolates problems.",
        keys: [["routing", "route", "static route"], ["connectivity", "reach", "ping"], ["troubleshoot", "isolate", "tell whether", "know"]], src: "Lab 3 §5" },
      { t: "mcq", q: "How many Security Associations are normally needed for two-way communication between two gateways?", opts: ["Two: one in each direction", "One shared SA", "Four", "None; IKE handles it"], a: 0, why: "An SA is one-directional.", src: "Lecture 3 §8" },
    ],
  });
})();
