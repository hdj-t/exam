// Network Security · Experiment 2 — Configuring Switch Port Security (Packet Tracer).
(() => {
  const { h } = Lab;
  const net = new Net.Network();
  const S = net.switch("S", { mac: "0002.4A7B.1101" });
  const PC0 = net.pc("PC0", { name: "PC0", mac: "0001.6432.8A01" });
  const PC1 = net.pc("PC1", { name: "PC1", mac: "0060.5C2A.11B3" });
  net.link("PC0", "FastEthernet0", "S", "FastEthernet0/1");
  net.booting = false;
  const F1 = "FastEthernet0/1";
  const port = () => S.ports[F1];
  const on = (pc) => net.peer(pc, "FastEthernet0")?.port === F1;
  const flag = {};
  const re = {
    psIf: /^\s*(do\s+)?sh\w*\s+port-s\w*\s+in\w*\s+(f\w*\s*)?0\/1\s*$/i,
    psAddr: /^\s*(do\s+)?sh\w*\s+port-s\w*\s+ad\w*\s*$/i,
    ifStatus: /^\s*(do\s+)?sh\w*\s+interfaces?\s+st\w*\s*$/i,
  };

  Lab.start({
    brief: `
<p>Restrict switch port <b>Fa0/1</b> to one authorised computer. PC0 is authorised. When PC1 takes its place, the switch sees a different MAC address and shuts the port down. Then you recover the port.</p>
<p class="key"><b>Key idea:</b> sticky learning automatically learns the first authorised MAC address and stores it as a secure MAC address.</p>
<h3>Addressing</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Device</th><th>IP address</th><th>Mask</th><th>Role</th></tr>
<tr><td>PC0</td><td>192.168.1.10</td><td>255.255.255.0</td><td>Authorised</td></tr>
<tr><td>PC1</td><td>192.168.1.20</td><td>255.255.255.0</td><td>Unauthorised</td></tr></table></div>
<h3>Violation modes</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Mode</th><th>Action</th></tr>
<tr><td>Protect</td><td>Drops unauthorised traffic.</td></tr>
<tr><td>Restrict</td><td>Drops traffic and records the violation.</td></tr>
<tr><td>Shutdown</td><td>Disables the port after a violation (used in this lab).</td></tr></table></div>
<h3>How this simulator works</h3>
<ul><li>Tap a device in the diagram, or its tab, to open its console. PCs have <b>IP Configuration</b> and a <b>Command Prompt</b>.</li>
<li>The switch understands real Cisco IOS: abbreviations (<code>conf t</code>, <code>int fa0/1</code>), <code>?</code> for help and Tab to complete.</li>
<li>Use the cable buttons under the diagram to unplug and swap PCs.</li>
<li>Each task is checked automatically. Stuck? Use <b>Hint</b> or <b>Show answer</b>.</li></ul>`,
    setup(api) {
      const topo = new api.Topo({
        w: 360, h: 210, label: "PC0 and PC1, switch S1 port Fa0/1",
        nodes: [
          { id: "S", kind: "switch", label: "S1", sub: "2960", x: 180, y: 50 },
          { id: "PC0", kind: "pc", label: "PC0", sub: "authorised", x: 90, y: 160 },
          { id: "PC1", kind: "pc", label: "PC1", sub: "unauthorised", x: 270, y: 160 },
        ],
        links: [{ a: "PC0", b: "S", al: "Fa0", bl: "Fa0/1" }, { a: "PC1", b: "S", al: "Fa0", bl: "Fa0/1" }],
        onClick: (id) => api.show(id),
      });
      const actions = h("div", { class: "topo-actions" });
      const note = h("p", { class: "topo-note" });
      api.stage.append(h("div", null, topo.el, actions, note));

      const terms = {
        S: Net.ios(net, "S", { after: (l) => afterSwitch(l) }),
        PC0: Net.pcPrompt(net, "PC0", { after: () => api.refresh() }),
        PC1: Net.pcPrompt(net, "PC1", { after: () => api.refresh() }),
      };
      api.termOf = (id) => terms[id];
      const panels = { PC0: Net.pcPanel(net, "PC0", terms.PC0, () => api.refresh()), PC1: Net.pcPanel(net, "PC1", terms.PC1, () => api.refresh()) };
      api.stage.append(api.dock());
      api.device("S", "S1", "Switch · CLI", terms.S.el);
      api.device("PC0", "PC0", "Desktop", panels.PC0);
      api.device("PC1", "PC1", "Desktop", panels.PC1);
      api.onShow = (id) => topo.select(id);
      topo.select("S");

      net.log = (id, text) => { terms[id]?.lines(text, "tl-log"); api.ping(id); };
      net.anim = (path, kind) => topo.packet(path, kind);
      let q = false;
      net.changed = () => {
        if (port().ps.count > 0) flag.violated = true;
        if (flag.violated && !port().ps.err && on("PC0") && net.upAt("S", F1)) flag.recovered = true;
        if (q) return;
        q = true;
        queueMicrotask(() => { q = false; draw(); api.refresh(); });
      };

      function afterSwitch(line) {
        const ps = port().ps;
        if (re.psIf.test(line)) {
          if (ps.err) flag.sawShutdown = true;
          else if (ps.on && net.upAt("S", F1)) { if (flag.recovered) flag.sawRecovered = true; else flag.sawSecureUp = true; }
        }
        if (re.psAddr.test(line) && ps.secure.some((s) => s.mac === PC0.mac)) flag.sawAddr = true;
        if (re.ifStatus.test(line) && ps.err) flag.sawShutdown = true;
        api.refresh();
      }

      function plug(pc) {
        const other = pc === "PC0" ? "PC1" : "PC0";
        if (on(other)) { api.toast(`Fa0/1 is in use. Unplug ${other} first.`); return; }
        net.link(pc, "FastEthernet0", "S", F1);
        api.toast(`${pc} connected to Fa0/1`);
      }
      function draw() {
        topo.update(
          (l) => (!on(l.a) ? "off" : net.upAt(l.a, "FastEthernet0") ? "up" : "down"),
          (n) => (n.id === "S" && port().ps.err ? "warn" : n.kind === "pc" && !on(n.id) ? "off" : null),
        );
        actions.replaceChildren(
          ...["PC0", "PC1"].map((pc) => on(pc)
            ? h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { net.unlink(pc); api.toast(`${pc} unplugged`); } }, `Unplug ${pc}`)
            : h("button", { class: "btn btn--s", type: "button", onclick: () => plug(pc) }, `Plug ${pc} into Fa0/1`)),
        );
        const ps = port().ps;
        note.textContent = !net.linkAt("S", F1) ? "Fa0/1: no cable." : ps.err ? "Fa0/1 is err-disabled (red link): the switch shut it down after a violation." : net.upAt("S", F1) ? `Fa0/1 is up${ps.on ? " · port security on" : ""}.` : "Fa0/1 is down.";
      }
      draw();
    },
    diagnose() {
      const ps = S.ports["FastEthernet0/1"].ps;
      if (!PC0.ip) return "PC0 has no IP address yet: open PC0 › IP Configuration.";
      if (net.lastFail) return net.lastFail;
      if (ps.err) return "Fa0/1 is err-disabled. Unplug PC1, plug PC0 back in, then on S1: interface fa0/1 → shutdown → no shutdown.";
      return "Everything looks connected. Check the task text and the hint.";
    },
    tasks: [
      { title: "Configure PC0 and PC1", detail: "PC0 = 192.168.1.10 /24, PC1 = 192.168.1.20 /24. Leave the default gateway empty.", where: "PC0 / PC1 › IP Configuration",
        hint: "Open PC0, choose IP Configuration, type the address and press Enter. The mask fills in as 255.255.255.0. Do the same on PC1.",
        answer: "PC0: 192.168.1.10  255.255.255.0\nPC1: 192.168.1.20  255.255.255.0",
        check: () => PC0.ip === "192.168.1.10" && PC0.mask === "255.255.255.0" && PC1.ip === "192.168.1.20" && PC1.mask === "255.255.255.0" && !PC0.gw && !PC1.gw },
      { title: "Name the switch S1", where: "S1 › CLI", hint: "Enter privileged mode, then global configuration, then set the hostname.", answer: "enable\nconfigure terminal\nhostname S1",
        device: "S", type: () => (S.mode === "user" ? "enable" : S.mode === "priv" ? "configure terminal" : "hostname S1"),
        check: () => S.hostname === "S1" },
      { title: "Make Fa0/1 an access port", detail: "Port security only works on an access port.", where: "S1 › CLI",
        hint: "Go into the interface first. <code>switchport port-security</code> is rejected on a dynamic port.", answer: "interface fastEthernet 0/1\nswitchport mode access",
        device: "S", type: () => (S.mode === "if" ? "switchport mode access" : "interface fastEthernet 0/1"),
        check: () => port().mode === "access" },
      { title: "Enable port security: maximum 1, sticky, shutdown", detail: "Then make sure the port is up with <code>no shutdown</code> and leave with <code>end</code>.", where: "S1 › CLI",
        hint: "Four port-security commands under interface Fa0/1. Maximum 1 and violation shutdown are also the defaults, but type them like the handout.",
        answer: "switchport port-security\nswitchport port-security maximum 1\nswitchport port-security mac-address sticky\nswitchport port-security violation shutdown\nno shutdown\nend",
        device: "S", type: () => { const ps = port().ps; return S.mode !== "if" ? "interface fastEthernet 0/1" : !ps.on ? "switchport port-security" : ps.max !== 1 ? "switchport port-security maximum 1" : !ps.sticky ? "switchport port-security mac-address sticky" : "switchport port-security violation shutdown"; },
        check: () => { const ps = port().ps; return ps.on && ps.max === 1 && ps.sticky && ps.violation === "shutdown"; } },
      { title: "Let the switch learn PC0's MAC", detail: "Generate traffic from PC0. The ping can fail (PC1 isn't connected), but PC0 still sends frames.", where: "PC0 › Command Prompt",
        hint: "Any frame from PC0 makes the switch learn its source MAC as SecureSticky.", answer: "ping 192.168.1.20", device: "PC0", type: "ping 192.168.1.20",
        check: () => port().ps.secure.some((s) => s.mac === PC0.mac && s.type === "SecureSticky") },
      { title: "Verify the authorised device", detail: "Expect Port Status <b>Secure-up</b>, Sticky MAC Addresses 1, Violation Count 0, and PC0's MAC in the secure table.", where: "S1 › CLI",
        hint: "Two show commands in privileged mode (or prefix them with <code>do</code> in config mode).", answer: "show port-security interface fastEthernet 0/1\nshow port-security address",
        device: "S", type: () => (!flag.sawSecureUp ? "show port-security interface fastEthernet 0/1" : "show port-security address"),
        check: () => flag.sawSecureUp && flag.sawAddr },
      { title: "Swap PC0 for PC1", detail: "Unplug PC0 and plug PC1 into the same Fa0/1 port.", where: "Cable buttons under the diagram",
        hint: "Use the buttons under the diagram: Unplug PC0, then Plug PC1 into Fa0/1.", check: () => on("PC1") || flag.violated },
      { title: "Generate traffic from PC1", detail: "The switch sees a new MAC on Fa0/1 and, in shutdown mode, disables the port. Watch S1's console.", where: "PC1 › Command Prompt",
        hint: "Ping PC0's address from PC1.", answer: "ping 192.168.1.10", device: "PC1", type: "ping 192.168.1.10",
        check: () => flag.violated },
      { title: "Check the violation", detail: "Expect <b>Secure-shutdown</b>, Violation Count 1 and the port <b>err-disabled</b>.", where: "S1 › CLI",
        hint: "Use the same port-security show command, or show interfaces status.", answer: "show port-security interface fastEthernet 0/1\nshow interfaces status",
        device: "S", type: "show port-security interface fastEthernet 0/1", check: () => flag.sawShutdown },
      { title: "Recover the port", detail: "Unplug PC1, reconnect PC0, then bounce the interface with shutdown / no shutdown.", where: "Cables + S1 › CLI",
        hint: "err-disabled ports don't come back by themselves. Remove the unauthorised device first, or it will trip again.",
        answer: "(unplug PC1, plug PC0)\nconfigure terminal\ninterface fastEthernet 0/1\nshutdown\nno shutdown\nend",
        device: "S", type: () => (S.mode === "priv" ? "configure terminal" : S.mode === "config" ? "interface fastEthernet 0/1" : port().shutdown ? "no shutdown" : "shutdown"),
        check: () => flag.recovered },
      { title: "Confirm Secure-up after recovery", where: "S1 › CLI", answer: "show port-security interface fastEthernet 0/1",
        device: "S", type: "show port-security interface fastEthernet 0/1", check: () => flag.sawRecovered },
      { title: "Save the configuration", detail: "So the sticky MAC survives a reload.", where: "S1 › CLI", hint: "Copy the running configuration to the startup configuration, in privileged mode.",
        answer: "copy running-config startup-config", device: "S", type: "copy running-config startup-config",
        check: () => !!S.startup && S.startup.ports[F1].ps.on && S.startup.ports[F1].ps.secure.some((s) => s.mac === PC0.mac) },
    ],
    doneText: "You secured Fa0/1, caught an unauthorised device, recovered the port and saved the sticky MAC. That is the full Experiment 2.",
    quiz: [
      { t: "mcq", q: "What is the purpose of Port Security?", opts: ["Control which devices may use a switch port based on MAC addresses", "Encrypt traffic between two switches", "Assign IP addresses to devices on a port", "Prevent switching loops between switches"], a: 0,
        why: "Port security restricts which MAC addresses may use an access port.", src: "Lab 2 §2 and §15 Q1; Lecture 2 §3 (Port Security – what it can do)" },
      { t: "cmd", q: "Which command displays the secure MAC addresses learned on the switch?", a: "show port-security address", why: "It lists Vlan, MAC, type (SecureSticky) and port.", src: "Lab 2 §8, §15 Q6" },
      { t: "mcq", q: "What does <code>switchport port-security maximum 1</code> mean?", opts: ["Only one secure MAC address may use the port", "Only one VLAN is allowed on the port", "The port allows one violation before shutting down", "Only one switch may connect to the port"], a: 0, src: "Lab 2 §6 table, §15 Q2" },
      { t: "tf", q: "If you type <code>switchport port-security</code> on a port that is still dynamic, the switch rejects the command.", a: true,
        why: "IOS answers “Command rejected: … is a dynamic port.” Configure <code>switchport mode access</code> first (troubleshooting table).", src: "Lab 2 §13" },
      { t: "match", q: "Match each violation mode to what it does.", pairs: [["Protect", "Drops unauthorised traffic"], ["Restrict", "Drops traffic and records the violation"], ["Shutdown", "Disables the port after a violation"]], src: "Lab 2 §3" },
      { t: "order", q: "Put the interface commands from the handout in order.", items: ["interface fastEthernet 0/1", "switchport mode access", "switchport port-security", "switchport port-security maximum 1", "switchport port-security mac-address sticky", "switchport port-security violation shutdown", "no shutdown"], src: "Lab 2 §6" },
      { t: "fill", q: "After PC1 replaces PC0 and sends traffic, <code>show port-security interface fa0/1</code> shows Port Status = <b>______</b>.", a: ["Secure-shutdown", "secure shutdown"], ph: "Port Status", src: "Lab 2 §10" },
      { t: "mcq", q: "What does <b>err-disabled</b> mean?", opts: ["The switch automatically disabled the interface because of an error or security violation", "An administrator typed shutdown on the interface", "The cable is not connected", "The port is waiting for DHCP"], a: 0, src: "Lab 2 §10 key idea" },
      { t: "multi", q: "Which steps recover an err-disabled port in this lab? (Choose all that apply)", opts: ["Remove the unauthorised device (PC1)", "Reconnect the authorised device (PC0)", "Enter <code>shutdown</code> then <code>no shutdown</code> on Fa0/1", "Reload the switch", "Delete the VLAN"], a: [0, 1, 2],
        why: "Remove PC1, reconnect PC0, then shutdown / no shutdown. Reloading is not part of the procedure.", src: "Lab 2 §11, §15 Q5" },
      { t: "short", q: "What is sticky learning, and why is it useful in this lab?", model: "With <code>mac-address sticky</code>, the switch automatically learns the MAC address of the first device that sends traffic (PC0) and stores it as a secure (SecureSticky) address in the running configuration. You don't have to type the MAC by hand, and after saving it survives a reload.",
        keys: [["learn", "learns"], ["automatic", "automatically"], ["secure"], ["first", "connected", "pc0"]], src: "Lab 2 §2, §15 Q3" },
      { t: "mcq", q: "PC1 is <b>not</b> blocked when it sends traffic on Fa0/1. Per the troubleshooting table, what do you verify first?", opts: ["Port Security: Enabled and Maximum MAC Addresses: 1", "The default gateway on PC1", "That DHCP snooping is enabled", "The VLAN number of PC0"], a: 0, src: "Lab 2 §13" },
      { t: "cmd", q: "Which command saves the configuration (including the sticky MAC) so it survives a reload?", a: ["copy running-config startup-config", "write memory", "write"], src: "Lab 2 §12" },
      { t: "mcq", q: "In a MAC flooding attack the attacker sends many frames with false source MACs. Which control from Lecture 2 directly limits this on an access port?", opts: ["Port Security", "Root Guard", "IPsec tunnel mode", "Network Address Translation"], a: 0,
        why: "Port security limits how many MAC addresses a port may learn, so the MAC table can't be flooded through it.", src: "Lecture 2 §3 (MAC Flooding and MAC Spoofing) and attack–protection summary" },
      { t: "tf", q: "Because port security filters by MAC address, it gives strong proof of a device's identity.", a: false,
        why: "Lecture 2: a MAC address is not strong proof of identity because software can change or imitate it. Use stronger authentication such as IEEE 802.1X.", src: "Lecture 2 §1 key idea and §3 key idea" },
      { t: "mcq", q: "Why does the switch learn PC0's MAC even though <code>ping 192.168.1.20</code> fails (PC1 isn't connected)?", opts: ["PC0 still sends frames (ARP requests), and the switch learns the source MAC of every frame it receives", "The ping succeeds silently in the background", "Sticky learning reads the MAC from the cable", "The switch asks PC0 for its MAC with DHCP"], a: 0,
        why: "A switch learns from the source MAC of incoming frames; PC0's ARP broadcasts are enough.", src: "Lab 2 §7; Lecture 2 §2 (switch learns from the source MAC)" },
    ],
  });
})();
