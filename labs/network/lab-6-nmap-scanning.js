// Network Security · Experiment 6 — Network Scanning Using Nmap (isolated lab: scanner + target laptops).
(() => {
  const { h } = Lab;
  const T = { ip: "192.168.50.10", mac: "3C:52:82:7B:10:AA" };
  const SC = { ip: "192.168.50.20" };
  const S = { server: false, port: null, fw: false, scans: [] };
  const flag = {};
  const stamp = () => "2026-11-13 14:" + String(new Date().getMinutes()).padStart(2, "0") + " Arab Standard Time";
  const dur = (a, b) => (a + Math.random() * (b - a)).toFixed(2);

  Lab.start({
    brief: `
<p>Use <b>Nmap</b> to discover active devices, scan TCP ports, identify the service on the target, and compare the result before and after stopping a test service.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>Laptop</th><th>IP</th><th>Software</th></tr>
<tr><td>Scanner</td><td>192.168.50.20/24</td><td>Nmap / Zenmap</td></tr>
<tr><td>Target</td><td>192.168.50.10/24</td><td>Python (test web server)</td></tr></table></div>
<h3>Options used</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Option</th><th>Meaning</th></tr>
<tr><td><code>-sn</code></td><td>Discovers active hosts without a port scan</td></tr>
<tr><td><code>-p 1-10000</code></td><td>Scans TCP ports 1 to 10000</td></tr>
<tr><td><code>-sV</code></td><td>Attempts to identify the service and version</td></tr></table></div>
<h3>Port states</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>State</th><th>Meaning</th></tr>
<tr><td>open</td><td>A service is accepting connections</td></tr>
<tr><td>closed</td><td>The host is reachable, but no service is listening on the port</td></tr>
<tr><td>filtered</td><td>A firewall/filter prevents Nmap from determining the port state</td></tr></table></div>
<p class="key">An open port does not automatically mean compromise. It is an exposed service that should be required, updated and protected.</p>
<p class="note">Scan only the authorised, isolated lab network.</p>`,
    setup(api) {
      const topo = new api.Topo({
        w: 340, h: 170, label: "Scanner and target on one switch",
        nodes: [
          { id: "scanner", kind: "laptop", label: "Scanner", sub: ".50.20", x: 70, y: 110 },
          { id: "sw", kind: "switch", label: "Lab switch", x: 170, y: 45 },
          { id: "target", kind: "laptop", label: "Target", sub: ".50.10", x: 270, y: 110 },
        ],
        links: [{ a: "scanner", b: "sw" }, { a: "sw", b: "target" }],
        onClick: (id) => api.show(id === "sw" ? "scanner" : id),
      });
      const note = h("p", { class: "topo-note" });
      api.stage.append(h("div", null, topo.el, note));
      const notRec = (c) => `'${c}' is not recognized as an internal or external command,\noperable program or batch file.`;

      // ---------- target
      const tterm = Kit.shell({
        prompt: () => "C:\\Users\\student\\lab>", theme: "cmd", ci: true, label: "Target command prompt", after: () => api.refresh(),
        banner: "Microsoft Windows [Version 10.0.22631.4317]\n(c) Microsoft Corporation. All rights reserved.", notFound: notRec,
        commands: {
          ipconfig: (a, t) => t.lines(`\nEthernet adapter Ethernet:\n\n   IPv4 Address. . . . . . . . . . . : ${T.ip}\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . :\n`),
          py: (a, t) => httpServer(a, t), python: (a, t) => httpServer(a, t),
          cls: (a, t) => (t.out.textContent = ""),
        },
      });
      async function httpServer(a, t) {
        if (a[1] !== "-m" || a[2] !== "http.server") {
          if (a.length === 1) return t.lines("Python 3.12.6 (tags/v3.12.6:a4a2d2b, Sep  6 2024) [MSC v.1940 64 bit (AMD64)] on win32\n(interactive mode isn't simulated — use: py -m http.server 8000)");
          return t.print(`${a[0]}: can't open file '${a.slice(1).join(" ")}': [Errno 2] No such file or directory`);
        }
        const port = +(a[3] || 8000);
        if (!(port > 0 && port < 65536)) return t.print("usage: server.py [-h] [--cgi] [--bind ADDRESS] [port]");
        S.server = true; S.port = port; api.refresh();
        t.print(`Serving HTTP on :: port ${port} (http://[::]:${port}/) ...`);
        if (!flag.fwPrompt) { flag.fwPrompt = true; t.print("[Windows Security] Windows Defender Firewall has blocked some features of Python — Allow access: Private networks ✓", "tl-dim"); }
        api.httpLog = (l) => t.print(l);
        while (await t.wait(500)) {}
        t.print(""); t.print("Keyboard interrupt received, exiting.");
        S.server = false; api.httpLog = null; flag.stopped = true; api.refresh();
      }

      // ---------- scanner
      const sterm = Kit.shell({
        prompt: () => "C:\\Users\\student>", theme: "cmd", ci: true, label: "Scanner command prompt", after: () => api.refresh(),
        banner: "Microsoft Windows [Version 10.0.22631.4317]\n(c) Microsoft Corporation. All rights reserved.", notFound: notRec,
        commands: {
          ipconfig: (a, t) => { flag.ipconfig = true; t.lines(`\nEthernet adapter Ethernet:\n\n   IPv4 Address. . . . . . . . . . . : ${SC.ip}\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . :\n`); },
          ping: async (a, t) => {
            const dst = a.find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
            if (!dst) return t.print("Usage: ping [-t] [-n count] target_name");
            t.print(""); t.print(`Pinging ${dst} with 32 bytes of data:`);
            const up = dst === T.ip || dst === SC.ip;
            for (let k = 0; k < 4; k++) { if (!(await t.wait(up ? 300 : 900))) break; t.print(up ? `Reply from ${dst}: bytes=32 time<1ms TTL=128` : "Request timed out."); }
            t.print(""); t.print(`Ping statistics for ${dst}:`); t.print(`    Packets: Sent = 4, Received = ${up ? 4 : 0}, Lost = ${up ? 0 : 4} (${up ? 0 : 100}% loss),`);
            if (dst === T.ip) flag.ping = true;
          },
          nmap: (a, t) => nmap(a, t),
          zenmap: (a, t) => t.print("Zenmap is the graphical front end; type nmap commands here — same options."),
          cls: (a, t) => (t.out.textContent = ""),
        },
      });
      const fwBtn = h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => {
        S.fw = !S.fw; fwBtn.textContent = S.fw ? "Firewall: blocking TCP 8000 — remove rule" : "Firewall: add rule blocking inbound TCP 8000";
        tterm.print(S.fw ? "[Windows Defender Firewall] Inbound rule added: Block TCP 8000 (Private)" : "[Windows Defender Firewall] Inbound rule removed", "tl-dim");
        api.refresh();
      } }, "Firewall: add rule blocking inbound TCP 8000");

      function parsePorts(spec) {
        if (spec === "-") return [1, 65535];
        const m = /^(\d+)(?:-(\d+))?$/.exec(spec || "");
        if (!m) return null;
        const a = +m[1], b = m[2] ? +m[2] : a;
        return a >= 1 && b <= 65535 && a <= b ? [a, b] : null;
      }
      async function nmap(a, t) {
        const args = a.slice(1);
        if (!args.length) return t.lines("Nmap 7.95 ( https://nmap.org )\nUsage: nmap [Scan Type(s)] [Options] {target specification}\n  -sn: Ping Scan - disable port scan\n  -sV: Probe open ports to determine service/version info\n  -p <port ranges>: Only scan specified ports\nEx: nmap -sV -p 1-10000 192.168.50.10");
        let sn = false, sV = false, range = [1, 1000], target = null, top = true;
        for (let k = 0; k < args.length; k++) {
          const x = args[k];
          if (x === "-sn") sn = true;
          else if (x === "-sV") sV = true;
          else if (x === "-sS" || x === "-sT" || x === "-Pn" || x === "-v" || x === "-T4") {}
          else if (x === "-p" || x.startsWith("-p")) {
            const spec = x === "-p" ? args[++k] : x.slice(2);
            const r = parsePorts(spec);
            if (!r) return t.print(`Error #487: Your port specifications are illegal.  Example of proper form: "-100,200-1024,T:3000-4000,U:60000-"`);
            range = r; top = false;
          } else if (/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(x)) target = x;
          else if (x.startsWith("-")) return t.lines(`nmap: unrecognized option '${x}'\nSee the output of nmap -h for a summary of options.`);
          else return t.lines(`Failed to resolve "${x}".\nWARNING: No targets were specified, so 0 hosts scanned.`);
        }
        if (!target) return t.lines("WARNING: No targets were specified, so 0 hosts scanned.\nNmap done: 0 IP addresses (0 hosts up) scanned in 0.05 seconds");
        t.print(`Starting Nmap 7.95 ( https://nmap.org ) at ${stamp()}`);
        const subnet = target.endsWith("/24");
        if (subnet && target !== "192.168.50.0/24") { if (!(await t.wait(2500))) return; return t.print(`Nmap done: 256 IP addresses (0 hosts up) scanned in ${dur(2, 3)} seconds`); }
        const hosts = subnet ? [T.ip, SC.ip] : [target];
        if (sn) {
          if (!(await t.wait(1600))) return;
          let up = 0;
          for (const ip of hosts) {
            if (ip === T.ip) { t.print(`Nmap scan report for ${ip}`); t.print("Host is up (0.0011s latency)."); t.print(`MAC Address: ${T.mac} (Hewlett Packard)`); up++; }
            else if (ip === SC.ip) { t.print(`Nmap scan report for ${ip}`); t.print("Host is up."); up++; }
          }
          t.print(`Nmap done: ${subnet ? 256 : 1} IP address${subnet ? "es" : ""} (${up} host${up === 1 ? "" : "s"} up) scanned in ${dur(1.8, 2.6)} seconds`);
          if (subnet && target === "192.168.50.0/24") flag.discovered = true;
          return;
        }
        if (subnet) return t.print("(Scanning a whole /24 for ports is slow; scan the target host: nmap -sV -p 1-10000 192.168.50.10)");
        if (target !== T.ip) { if (!(await t.wait(1500))) return; t.print("Note: Host seems down. If it is really up, but blocking our ping probes, try -Pn"); return t.print(`Nmap done: 1 IP address (0 hosts up) scanned in ${dur(1.5, 3)} seconds`); }
        const n = range[1] - range[0] + 1;
        const span = (p) => p >= range[0] && p <= range[1] && (!top || p === 8000);
        if (!(await t.wait(sV ? 2600 : 1600))) return;
        if (sV && S.server && span(S.port) && !S.fw && api.httpLog) {
          api.httpLog(`${SC.ip} - - [13/Nov/2026 14:05:11] "GET / HTTP/1.0" 200 -`);
          api.httpLog(`${SC.ip} - - [13/Nov/2026 14:05:12] code 400, message Bad request version ('RTSP/1.0')`);
          api.httpLog(`${SC.ip} - - [13/Nov/2026 14:05:12] "OPTIONS / RTSP/1.0" 400 -`);
        }
        t.print(`Nmap scan report for ${T.ip}`);
        t.print(`Host is up (0.00089s latency).`);
        const p = S.port ?? 8000;
        const inScan = span(8000) || (S.server && span(p));
        const state = !inScan ? null : S.fw && (p === 8000 || !S.server) ? "filtered" : S.server && span(p) ? "open" : span(8000) ? "closed" : null;
        const port = S.server && span(p) ? p : 8000;
        const svc = port === 8000 ? "http-alt" : "unknown";
        if (!state) {
          t.print(`All ${n} scanned ports on ${T.ip} are in ignored states.`);
          t.print(`Not shown: ${n} filtered tcp ports (no-response)`);
        } else {
          if (n > 1) t.print(`Not shown: ${n - 1} filtered tcp ports (no-response)`);
          t.print("PORT     STATE    SERVICE  VERSION".slice(0, sV ? 99 : 26));
          const ver = state === "open" && sV ? "SimpleHTTPServer 0.6 (Python 3.12.6)" : "";
          t.print(`${(port + "/tcp").padEnd(9)}${state.padEnd(9)}${(state === "open" && sV ? "http" : svc).padEnd(9)}${ver}`);
        }
        t.print(`MAC Address: ${T.mac} (Hewlett Packard)`);
        if (sV) { t.print(""); t.print("Service detection performed. Please report any incorrect results at https://nmap.org/submit/ ."); }
        t.print(`Nmap done: 1 IP address (1 host up) scanned in ${dur(sV ? 18 : 4, sV ? 26 : 7)} seconds`);
        S.scans.push({ state, sV, n, port });
        if (state === "open" && sV && range[0] <= 1 && range[1] >= 10000) flag.open = true;
        if (state === "closed" && sV && flag.stopped) flag.closed = true;
        if (state === "filtered") flag.filtered = true;
      }
      api.termOf = (id) => (id === "target" ? tterm : sterm);
      api.stage.append(api.dock());
      api.device("scanner", "Scanner", "Command Prompt · Nmap", sterm.el);
      api.device("target", "Target", "Command Prompt", h("div", null, h("div", { class: "row", style: "margin-block-end:.5rem" }, fwBtn), tterm.el));
      api.onShow = (id) => topo.select(id);
      topo.select("scanner");
      const r0 = api.refresh;
      api.refresh = () => {
        topo.update(null, (nd) => (nd.id === "target" && S.server ? "ok" : null));
        note.textContent = `Target: ${S.server ? `python http.server running on TCP ${S.port}` : "no test service running"}${S.fw ? " · firewall blocks TCP 8000" : ""}`;
        r0();
      };
      api.refresh();
    },
    tasks: [
      { title: "Start the test web service on the target", detail: "This opens a web service on TCP port 8000. Leave it running.", where: "Target › Command Prompt",
        hint: "If <code>py</code> doesn't work on a real PC, use <code>python</code>.", answer: "py -m http.server 8000", device: "target", type: "py -m http.server 8000", check: () => S.server && S.port === 8000 },
      { title: "On the scanner: check your address and reach the target", where: "Scanner › Command Prompt", answer: "ipconfig\nping 192.168.50.10",
        device: "scanner", type: () => (flag.ipconfig ? "ping 192.168.50.10" : "ipconfig"), check: () => flag.ipconfig && flag.ping },
      { title: "Discover active hosts (no port scan)", where: "Scanner", hint: "Scan the whole /24 with the option that disables port scanning.",
        answer: "nmap -sn 192.168.50.0/24", device: "scanner", type: "nmap -sn 192.168.50.0/24", check: () => flag.discovered },
      { title: "Scan TCP ports 1–10000 with service detection", detail: "Find port 8000 and the detected service. Watch the target's console too: you can see Nmap's probes.", where: "Scanner",
        answer: "nmap -sV -p 1-10000 192.168.50.10", device: "scanner", type: "nmap -sV -p 1-10000 192.168.50.10", check: () => flag.open },
      { title: "Stop the service on the target", where: "Target › Command Prompt", hint: "The server runs until you interrupt it.", answer: "Ctrl + C", check: () => flag.stopped && !S.server },
      { title: "Rescan port 8000", detail: "Expected: <b>8000/tcp closed</b>, proving the port was open only because the service was running.", where: "Scanner",
        answer: "nmap -sV -p 8000 192.168.50.10", device: "scanner", type: "nmap -sV -p 8000 192.168.50.10", check: () => flag.closed },
      { title: "Bonus: see a <i>filtered</i> port", detail: "Start the server again, add the firewall rule on the target, and scan port 8000. A firewall that drops probes gives <b>filtered</b>.", where: "Target + Scanner",
        hint: "Target: <code>py -m http.server 8000</code>, then press the firewall button. Scanner: <code>nmap -p 8000 192.168.50.10</code>.",
        answer: "(Target) py -m http.server 8000 → Firewall button\n(Scanner) nmap -p 8000 192.168.50.10", device: () => (S.server && S.fw ? "scanner" : "target"), type: () => (!S.server ? "py -m http.server 8000" : S.fw ? "nmap -p 8000 192.168.50.10" : ""), check: () => flag.filtered },
    ],
    doneText: "Port 8000 was open with the Python server running, closed after you stopped it, and filtered behind the firewall: all three port states.",
    quiz: [
      { t: "mcq", q: "What is Nmap used for?", opts: ["Discovering network devices, ports and running services", "Encrypting traffic between hosts", "Capturing and decoding packets like Wireshark", "Assigning IP addresses"], a: 0, src: "Lab 6 §12 Q1" },
      { t: "mcq", q: "What does <code>-sn</code> do?", opts: ["Discovers active hosts without scanning ports", "Scans every TCP port", "Detects service versions", "Performs a stealth SYN scan"], a: 0, src: "Lab 6 §5, §12 Q2" },
      { t: "fill", q: "Which option makes Nmap attempt to identify the service and its version?", a: ["-sV", "sV"], src: "Lab 6 §5, §12 Q3" },
      { t: "cmd", q: "Write the command that scans TCP ports 1 to 10000 on 192.168.50.10 with service detection.", a: ["nmap -sV -p 1-10000 192.168.50.10", "nmap -p 1-10000 -sV 192.168.50.10"], src: "Lab 6 §4" },
      { t: "match", q: "Match each port state to its meaning.", pairs: [["open", "A service is accepting connections"], ["closed", "Host reachable, but nothing listening on the port"], ["filtered", "A firewall/filter prevents Nmap from determining the state"]], src: "Lab 6 §7" },
      { t: "fill", q: "Which TCP port is open in this experiment?", a: ["8000", "8000/tcp", "tcp 8000"], src: "Lab 6 §6, §12 Q4" },
      { t: "cmd", q: "Which command starts the test web service on the target?", a: ["py -m http.server 8000", "python -m http.server 8000"], src: "Lab 6 §3" },
      { t: "tf", q: "An open port automatically means the host has been compromised.", a: false, why: "It is an exposed service that should be required, updated and protected.", src: "Lab 6 §7" },
      { t: "multi", q: "How can open ports be secured? (Choose all that apply)", opts: ["Close unused services", "Update software", "Configure the firewall", "Change the MAC address", "Disable ARP"], a: [0, 1, 2], src: "Lab 6 §12 Q5" },
      { t: "order", q: "Order the experiment.", items: ["Start the Python web server on port 8000", "Use -sn to discover active devices", "Scan ports 1-10000 with service detection", "Identify port 8000 and the service", "Stop the Python service", "Rescan port 8000 and see it closed"], src: "Lab 6 §9" },
      { t: "mcq", q: "The target is not discovered. Which check does the troubleshooting table list first?", opts: ["IP addresses, connection, ping and local firewall", "Reinstall Python", "Change the scan to -p-", "Use a different switch port speed"], a: 0, src: "Lab 6 §11" },
      { t: "short", q: "After stopping the service, port 8000 shows <code>closed</code> instead of <code>open</code>. What does that prove?", model: "The host is still reachable but nothing is listening on 8000 any more, so the port was open only because the Python test service was running. Open ports reflect running services.",
        keys: [["service", "server"], ["running", "listening"], ["reachable", "host is up", "still up"]], src: "Lab 6 §8" },
      { t: "mcq", q: "A ping sweep sends ICMP requests to many addresses to find live hosts. In Lecture 3 this is an example of…", opts: ["ICMP abuse used for reconnaissance", "IP spoofing", "A fragmentation attack", "A routing attack"], a: 0, src: "Lecture 3 §3 (ICMP: useful but abusable)" },
    ],
  });
})();
