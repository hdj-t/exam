// Network Security · Experiment 5 — ARP Spoofing and Detection (isolated lab: Kali + Windows + Wireshark).
(() => {
  const { h } = Lab;
  const IP = { target: "192.168.50.1", victim: "192.168.50.10", kali: "192.168.50.20" };
  const MAC = { target: "00:1a:2b:3c:4d:01", victim: "3c:52:82:7b:10:aa", kali: "08:00:27:5e:a1:9c" };
  const win = (m) => m.replace(/:/g, "-");
  const short = (m) => m.split(":").map((x) => x.replace(/^0(?=.)/, "")).join(":"); // arpspoof prints 8:0:27:…
  const S = { cache: {}, admin: false, dsniff: false, spoofing: false, wrongTarget: false };
  const flag = {};

  Lab.start({
    brief: `
<p>Perform a simple <b>ARP spoofing</b> test inside an <b>isolated</b> lab network, then detect it from the victim's ARP table and in Wireshark, and clean up.</p>
<h3>Topology</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Device</th><th>IP address</th><th>MAC (this simulation)</th></tr>
<tr><td>Target PC</td><td>192.168.50.1</td><td><code>00:1a:2b:3c:4d:01</code></td></tr>
<tr><td>Victim PC (Windows + Wireshark)</td><td>192.168.50.10</td><td><code>3c:52:82:7b:10:aa</code></td></tr>
<tr><td>Kali attacker</td><td>192.168.50.20</td><td><code>08:00:27:5e:a1:9c</code></td></tr></table></div>
<p>Subnet mask 255.255.255.0. The attacker uses <code>arpspoof</code> from the <b>dsniff</b> package.</p>
<p class="key"><b>What happens:</b> Kali keeps sending forged ARP replies to the victim saying “192.168.50.1 is at <i>Kali's MAC</i>”. The victim's ARP cache is poisoned, so traffic for the target goes to Kali instead (a Man-in-the-Middle position, Lecture 2 §4).</p>
<p class="note"><b>Ethics:</b> only on systems you are authorised to test, in an isolated lab. Never on the university or a public network.</p>`,
    setup(api) {
      const topo = new api.Topo({
        w: 360, h: 200, label: "Victim, Target and Kali on one switch",
        nodes: [
          { id: "sw", kind: "switch", label: "Lab switch", x: 180, y: 60 },
          { id: "victim", kind: "laptop", label: "Victim", sub: ".50.10", x: 60, y: 150 },
          { id: "target", kind: "pc", label: "Target", sub: ".50.1", x: 180, y: 160 },
          { id: "kali", kind: "kali", label: "Kali", sub: ".50.20", x: 300, y: 150 },
        ],
        links: [{ a: "victim", b: "sw" }, { a: "target", b: "sw" }, { a: "kali", b: "sw" }],
        onClick: (id) => api.show(id === "target" || id === "sw" ? "victim" : id),
      });
      const note = h("p", { class: "topo-note" });
      api.stage.append(h("div", null, topo.el, note));

      // ---------- Wireshark on the victim
      const ws = Kit.wireshark({
        ifaces: ["Wi-Fi", "Ethernet", "Adapter for loopback traffic capture"],
        okIface: (i) => i === "Ethernet",
        idle: "Capture on the victim. The lab network is wired: choose Ethernet, press Start, then filter with arp.",
        onStart: () => api.refresh(), onStop: () => api.refresh(),
        onFilter: () => api.refresh(),
      });
      const arpPkt = (src, dstMac, info, extra = {}) => ws.add({ src, dst: dstMac, proto: "ARP", len: 42, info, layers: ["eth", "arp"], f: { "eth.src": src, "eth.addr": [src, dstMac] }, ...extra });
      const icmp = (s, d, info) => ws.add({ src: s, dst: d, proto: "ICMP", len: 74, info, layers: ["eth", "ip", "icmp"], f: { "ip.src": s, "ip.dst": d, "ip.addr": [s, d] } });

      // ---------- Victim: Windows Command Prompt
      const vterm = Kit.shell({
        prompt: () => (S.admin ? "C:\\Windows\\system32>" : "C:\\Users\\student>"), theme: "cmd", ci: true, label: "Victim command prompt",
        banner: "Microsoft Windows [Version 10.0.22631.4317]\n(c) Microsoft Corporation. All rights reserved.",
        after: () => api.refresh(),
        notFound: (c) => `'${c}' is not recognized as an internal or external command,\noperable program or batch file.`,
        commands: {
          ipconfig: (a, t) => t.lines(`\nWindows IP Configuration\n\n\nEthernet adapter Ethernet:\n\n   Connection-specific DNS Suffix  . :\n   IPv4 Address. . . . . . . . . . . : ${IP.victim}\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . :\n`),
          ping: async (a, t) => {
            const dst = a.find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
            if (!dst) return t.print("Usage: ping [-t] [-n count] target_name");
            t.print(""); t.print(`Pinging ${dst} with 32 bytes of data:`);
            const owner = Object.entries(IP).find(([, v]) => v === dst)?.[0];
            if (owner && !S.cache[dst]) {
              arpPkt(MAC.victim, "ff:ff:ff:ff:ff:ff", `Who has ${dst}? Tell ${IP.victim}`);
              S.cache[dst] = MAC[owner];
              arpPkt(MAC[owner], MAC.victim, `${dst} is at ${MAC[owner]}`);
            }
            let ok = 0;
            for (let k = 0; k < 4; k++) {
              const good = owner && S.cache[dst] === MAC[owner];
              icmp(IP.victim, dst, `Echo (ping) request  id=0x0001, seq=${k + 1}/${(k + 1) * 256}, ttl=128`);
              if (!(await t.wait(good ? 300 : 900))) break;
              if (good) { ok++; icmp(dst, IP.victim, `Echo (ping) reply    id=0x0001, seq=${k + 1}/${(k + 1) * 256}, ttl=64`); t.print(`Reply from ${dst}: bytes=32 time<1ms TTL=64`); }
              else t.print("Request timed out.");
            }
            t.print(""); t.print(`Ping statistics for ${dst}:`); t.print(`    Packets: Sent = 4, Received = ${ok}, Lost = ${4 - ok} (${(4 - ok) * 25}% loss),`);
            if (dst === IP.target) {
              if (ok === 4 && !S.spoofing && !flag.poisoned) flag.pingBefore = true;
              if (ok === 0 && S.cache[IP.target] === MAC.kali) flag.pingDuring = true;
              if (ok === 4 && flag.cleared) flag.pingAfter = true;
            }
          },
          arp: (a, t) => {
            const f = (a[1] || "").toLowerCase();
            if (f === "-a") {
              t.print(""); t.print(`Interface: ${IP.victim} --- 0xb`); t.print("  Internet Address      Physical Address      Type");
              for (const [ip, m] of Object.entries(S.cache)) t.print(`  ${ip.padEnd(22)}${win(m).padEnd(22)}dynamic`);
              t.print(`  ${"192.168.50.255".padEnd(22)}${"ff-ff-ff-ff-ff-ff".padEnd(22)}static`);
              t.print(`  ${"224.0.0.22".padEnd(22)}${"01-00-5e-00-00-16".padEnd(22)}static`);
              t.print(`  ${"224.0.0.251".padEnd(22)}${"01-00-5e-00-00-fb".padEnd(22)}static`);
              const cur = S.cache[IP.target];
              if (cur === MAC.target && !flag.poisoned) flag.arpBefore = true;
              if (cur === MAC.kali) flag.arpDuring = true;
              if (cur === MAC.target && flag.cleared) flag.arpAfter = true;
              return;
            }
            if (f === "-d") {
              if (!S.admin) return t.print("The ARP entry deletion failed: The requested operation requires elevation.");
              S.cache = {}; flag.cleared = true; return;
            }
            t.lines("\nDisplays and modifies the IP-to-Physical address translation tables used by\naddress resolution protocol (ARP).\n\nARP -s inet_addr eth_addr [if_addr]\nARP -d inet_addr [if_addr]\nARP -a [inet_addr] [-N if_addr] [-v]");
          },
          cls: (a, t) => (t.out.textContent = ""),
          hostname: (a, t) => t.print("VICTIM-PC"),
          whoami: (a, t) => t.print("victim-pc\\student"),
        },
      });
      const adminBtn = h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => {
        S.admin = !S.admin; adminBtn.textContent = S.admin ? "Close admin prompt" : "Run as administrator";
        vterm.print(""); vterm.print(S.admin ? "Administrator: Command Prompt" : "Command Prompt", "tl-dim"); vterm.setPrompt(); api.refresh();
      } }, "Run as administrator");

      // ---------- Kali terminal
      const kprompt = () => "┌──(kali㉿kali)-[~]\n└─$ ";
      let spoofTimer = null;
      const kterm = Kit.shell({
        prompt: () => "(kali㉿kali)-[~]$ ", theme: "kali", label: "Kali terminal", after: () => api.refresh(),
        banner: "Kali GNU/Linux Rolling — attacker laptop on the isolated lab network",
        commands: {
          ip: (a, t) => t.lines(`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP\n    link/ether ${MAC.kali} brd ff:ff:ff:ff:ff:ff\n    inet ${IP.kali}/24 brd 192.168.50.255 scope global eth0`),
          ifconfig: (a, t) => t.lines(`eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet ${IP.kali}  netmask 255.255.255.0  broadcast 192.168.50.255\n        ether ${MAC.kali}  txqueuelen 1000  (Ethernet)`),
          whoami: (a, t) => t.print("kali"),
          clear: (a, t) => (t.out.textContent = ""),
          arpspoof: (a, t) => t.lines("libnet_init: UID or EUID of 0 required\n(run it with sudo)"),
          sudo: async (a, t) => {
            if (!flag.sudoOk) { const p = await t.ask("[sudo] password for kali: ", { secret: true }); if (p == null) return; flag.sudoOk = true; }
            const cmd = a.slice(1);
            if (cmd[0] === "apt" || cmd[0] === "apt-get") {
              if (cmd[1] !== "install" || !cmd.includes("dsniff")) return t.print("E: Usage: apt install dsniff -y");
              if (S.dsniff) return t.print("dsniff is already the newest version (2.4b1+debian-33)."), t.print("0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.");
              for (const l of ["Reading package lists... Done", "Building dependency tree... Done", "Reading state information... Done", "The following NEW packages will be installed:", "  dsniff libnids1.21t64", "0 upgraded, 2 newly installed, 0 to remove and 0 not upgraded.", "Get:1 http://http.kali.org/kali kali-rolling/main amd64 dsniff amd64 2.4b1+debian-33 [117 kB]", "Unpacking dsniff (2.4b1+debian-33) ...", "Setting up dsniff (2.4b1+debian-33) ...", "Processing triggers for man-db (2.13.0-1) ..."]) { t.print(l); if (!(await t.wait(220))) return; }
              if (!cmd.includes("-y")) t.print("(installed — note: without -y apt would ask you to confirm)", "tl-dim");
              S.dsniff = true; return;
            }
            if (cmd[0] === "arpspoof") {
              if (!S.dsniff) return t.print("sudo: arpspoof: command not found");
              const ii = cmd.indexOf("-i"), ti = cmd.indexOf("-t");
              const iface = ii >= 0 ? cmd[ii + 1] : null, tgt = ti >= 0 ? cmd[ti + 1] : null;
              const host = cmd.filter((x, k) => k > 0 && x !== "-i" && x !== "-t" && cmd[k - 1] !== "-i" && cmd[k - 1] !== "-t" && /^\d/.test(x))[0];
              if (!host) return t.lines("Version: 2.4\nUsage: arpspoof [-i interface] [-c own|host|both] [-t target] [-r] host");
              if (iface && iface !== "eth0") return t.print(`arpspoof: libnet_init(): libnet_check_iface() ioctl: No such device`);
              if (![IP.target, IP.victim].includes(host) || (tgt && ![IP.target, IP.victim].includes(tgt))) return t.print(`arpspoof: couldn't arp for host ${tgt || host}`);
              const victim = tgt;
              const poisonsVictim = victim === IP.victim && host === IP.target;
              S.spoofing = true; S.wrongTarget = !poisonsVictim; api.refresh();
              const vMac = victim ? (victim === IP.victim ? MAC.victim : MAC.target) : "ff:ff:ff:ff:ff:ff";
              while (true) {
                t.print(`${short(MAC.kali)} ${short(vMac)} 0806 42: arp reply ${host} is-at ${short(MAC.kali)}`);
                if (poisonsVictim) {
                  const dup = S.cache[IP.target] === MAC.target || flag.poisoned;
                  S.cache[IP.target] = MAC.kali; flag.poisoned = true;
                  arpPkt(MAC.kali, MAC.victim, `${IP.target} is at ${MAC.kali}${dup ? ` (duplicate use of ${IP.target} detected!)` : ""}`, { cls: dup ? "dup" : "arp" });
                  flag.replies = (flag.replies || 0) + (ws.running && /^\s*arp\s*$/i.test(ws.filter || "") ? 1 : 0);
                }
                api.refresh();
                if (!(await t.wait(2000))) break;
              }
              t.print("Cleaning up and re-arping targets...");
              S.spoofing = false; flag.stopped = true; api.refresh();
              return;
            }
            if (!cmd.length) return t.print("usage: sudo command");
            t.print(`sudo: ${cmd[0]}: command not found`);
          },
        },
      });
      api.termOf = (id) => (id === "victim" ? vterm : id === "kali" ? kterm : null);
      api.stage.append(api.dock());
      api.device("victim", "Victim", "Command Prompt", h("div", null, h("div", { class: "row", style: "margin-block-end:.5rem" }, adminBtn), vterm.el));
      api.device("ws", "Wireshark", "on Victim", ws.el);
      api.device("kali", "Kali", "Terminal", kterm.el);
      api.onShow = (id) => topo.select(id === "ws" ? "victim" : id);
      topo.select("victim");
      const draw = () => {
        topo.update(null, (n) => (n.id === "kali" && S.spoofing ? "warn" : null));
        const c = S.cache[IP.target];
        note.textContent = `Victim's ARP entry for 192.168.50.1: ${c ? c + (c === MAC.kali ? "  ← Kali's MAC (poisoned)" : "  (correct)") : "none yet"}${S.spoofing ? " · arpspoof running" : ""}`;
      };
      const r0 = api.refresh;
      api.refresh = () => { draw(); r0(); };
      draw();
    },
    tasks: [
      { title: "Before the attack: ping the target and read the ARP table", detail: "Record the real MAC address of 192.168.50.1.", where: "Victim › Command Prompt",
        answer: "ping 192.168.50.1\narp -a", device: "victim", type: () => (flag.pingBefore ? "arp -a" : "ping 192.168.50.1"), check: () => flag.pingBefore && flag.arpBefore },
      { title: "Start Wireshark with the <code>arp</code> filter", detail: "Capture on the active interface (the lab is wired), then apply the display filter <code>arp</code>.", where: "Wireshark",
        hint: "Pick <b>Ethernet</b>, press Start, type <code>arp</code> in the filter bar and press Apply.", check: () => S && flag && document && wsReady() },
      { title: "Install dsniff on Kali", where: "Kali › Terminal", hint: "It needs root, so prefix with sudo. The sudo password in this lab is anything you type.",
        answer: "sudo apt install dsniff -y", device: "kali", type: "sudo apt install dsniff -y", check: () => S.dsniff },
      { title: "Start ARP spoofing against the victim", detail: "Tell the victim (<code>-t</code>) that the target's IP belongs to Kali.", where: "Kali › Terminal",
        hint: "Syntax: <code>arpspoof -i &lt;interface&gt; -t &lt;victim&gt; &lt;host to impersonate&gt;</code>. Leave it running.",
        answer: "sudo arpspoof -i eth0 -t 192.168.50.10 192.168.50.1", device: "kali", type: "sudo arpspoof -i eth0 -t 192.168.50.10 192.168.50.1",
        check: () => flag.poisoned },
      { title: "Detect it on the victim: ARP table and ping", detail: "The MAC for 192.168.50.1 should now be Kali's, and the ping may fail.", where: "Victim › Command Prompt",
        answer: "arp -a\nping 192.168.50.1", device: "victim", type: () => (flag.arpDuring ? "ping 192.168.50.1" : "arp -a"), check: () => flag.arpDuring && flag.pingDuring },
      { title: "See the repeated forged ARP replies in Wireshark", detail: "Look for “192.168.50.1 is at 08:00:27:5e:a1:9c” over and over, and Wireshark's <b>duplicate use</b> warning.", where: "Wireshark",
        hint: "Keep arpspoof running and the arp filter applied for a few seconds.", check: () => (flag.replies || 0) >= 3 },
      { title: "Stop the attack", where: "Kali › Terminal", hint: "arpspoof runs until you interrupt it.", answer: "Ctrl + C", check: () => flag.stopped },
      { title: "Clear the victim's ARP cache as Administrator", detail: "A normal prompt can't delete ARP entries.", where: "Victim › Command Prompt",
        hint: "Press <b>Run as administrator</b> first, then delete every entry with the wildcard.", answer: "(Run as administrator)\narp -d *", device: "victim", type: "arp -d *", check: () => flag.cleared },
      { title: "Verify the correct MAC is back", where: "Victim › Command Prompt", answer: "ping 192.168.50.1\narp -a",
        device: "victim", type: () => (flag.pingAfter ? "arp -a" : "ping 192.168.50.1"), check: () => flag.pingAfter && flag.arpAfter },
    ],
    doneText: "You recorded the real MAC, poisoned the victim's cache from Kali, detected it in the ARP table and in Wireshark, stopped it and restored the cache.",
    quiz: [
      { t: "mcq", q: "What is ARP spoofing?", opts: ["Sending forged ARP replies so an IP address is associated with the wrong MAC address", "Flooding a switch with fake MAC addresses", "Changing a PC's IP address to an unused one", "Sending fake DHCP offers"], a: 0, src: "Lab 5 §11; Lecture 2 §4" },
      { t: "multi", q: "How was the attack detected in this experiment? (Choose all that apply)", opts: ["The MAC for 192.168.50.1 changed to Kali's MAC in <code>arp -a</code>", "Repeated ARP Reply packets in Wireshark", "The victim's IP address changed", "The switch shut the port down"], a: [0, 1], src: "Lab 5 §7, §11" },
      { t: "cmd", q: "Which command clears the ARP cache on the Windows victim?", a: ["arp -d *", "arp -d"], why: "Run it in a Command Prompt opened as Administrator.", src: "Lab 5 §8, §11" },
      { t: "cmd", q: "Write the arpspoof command used in the lab (interface eth0, victim 192.168.50.10, impersonating 192.168.50.1).", a: ["sudo arpspoof -i eth0 -t 192.168.50.10 192.168.50.1"], src: "Lab 5 §6" },
      { t: "fill", q: "Which Wireshark display filter shows only ARP traffic?", a: ["arp"], src: "Lab 5 §5" },
      { t: "tf", q: "arpspoof sends a single forged ARP reply and then exits.", a: false, why: "It repeatedly sends forged replies until you stop it with Ctrl+C, so the poisoned entry keeps being refreshed.", src: "Lab 5 §6, §8" },
      { t: "match", q: "Match each tool to its job in the lab.", pairs: [["Kali Linux", "Attacker laptop"], ["dsniff / arpspoof", "Sends the forged ARP replies"], ["Wireshark", "Captures the ARP packets on the victim"], ["arp -a", "Shows the victim's IP-to-MAC table"]], src: "Lab 5 §2, §4–7" },
      { t: "order", q: "Order the procedure.", items: ["Record the ARP table before the test", "Start Wireshark and apply the arp filter", "Run arpspoof from Kali", "Capture the changed MAC and repeated ARP replies", "Stop the test with Ctrl+C", "Clear the ARP cache with arp -d *", "Verify the correct MAC is restored"], src: "Lab 5 §9" },
      { t: "mcq", q: "Why can an attacker poison an ARP cache at all?", opts: ["Basic ARP does not strongly authenticate replies, so false IP-to-MAC information is accepted", "ARP is encrypted with a weak key", "Switches forward ARP only to the gateway", "ARP uses TCP, which can be hijacked"], a: 0, src: "Lecture 2 §4" },
      { t: "multi", q: "Which protections against ARP spoofing are listed in Lecture 2? (Choose all that apply)", opts: ["Dynamic ARP Inspection (DAI)", "DHCP Snooping", "Encryption of application traffic", "Monitoring for unusual or duplicate ARP entries", "BPDU Guard"], a: [0, 1, 2, 3], src: "Lecture 2 §4 (Protection)" },
      { t: "mcq", q: "Dynamic ARP Inspection validates ARP packets against…", opts: ["Trusted IP-to-MAC bindings, commonly from the DHCP Snooping database", "The router's routing table", "The STP root bridge", "The DNS server"], a: 0, src: "Lecture 2 §4 key idea" },
      { t: "short", q: "During the attack the victim's ping to 192.168.50.1 may fail. Explain why.", model: "The victim's ARP cache maps 192.168.50.1 to Kali's MAC, so frames meant for the target are delivered to Kali. Unless Kali forwards them (IP forwarding), they are dropped, so the ping fails or behaves abnormally.",
        keys: [["kali", "attacker"], ["mac"], ["forward", "forwarding", "dropped", "not delivered"]], src: "Lab 5 §7; Lecture 2 §4 (Man-in-the-Middle)" },
      { t: "tf", q: "ARP spoofing mainly works across different IP networks through routers.", a: false, why: "ARP works on the local network (Layer 2); the attacker must be on the same LAN/broadcast domain.", src: "Lecture 2 §4" },
    ],
  });

  // the Wireshark task: running on Ethernet with exactly the arp filter applied
  function wsReady() {
    const bar = document.querySelector(".ws");
    if (!bar) return false;
    const status = bar.querySelector(".topo-note")?.textContent || "";
    return /Capturing/.test(status) && /filter: arp$/i.test(status.trim());
  }
})();
