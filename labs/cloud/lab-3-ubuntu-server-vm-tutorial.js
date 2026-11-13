// Cloud Computing · Lab 3 — Ubuntu Server VM on VMware Workstation (Parts 1–6).
(() => {
  const { h } = Lab;
  const { field, radios, win } = Kit;
  const ISO = "ubuntu-26.04.1-live-server-amd64.iso";
  const GOOD = "c3514bf0056180d09376462a7a1b4f213c1d6e8ea67fae5c25099c6fd3d8274b";
  const BAD = "9a1f2e77c0b4d86e1f5a0c2b3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f";
  const S = {
    vtx: false, iso: "downloads", corrupt: true, hashed: null, vmw: false, vm: null, installer: null, installed: false,
    power: "off", login: null, layout: "ENG US", ran: new Set(), snapshots: [], profile: {},
  };

  Lab.start({
    brief: `
<p>Build your own <b>Ubuntu Server</b> virtual machine on <b>VMware Workstation Pro</b>, prove it's virtual, and save a restore point — the whole six-part tutorial.</p>
<ol><li>Check virtualization and verify the ISO's SHA-256.</li><li>(Broadcom account and download — summarised.)</li><li>(Install Workstation — summarised.)</li><li>Create the VM: <b>ubuntu-lab</b>, C:\\VMs\\ubuntu-lab, 20 GB split disk, 4096 MB, 2 CPUs, NAT, 3D off.</li><li>Install Ubuntu Server with the keyboard only.</li><li>First login, verification commands, <code>sudo poweroff</code>, snapshot <b>clean-install</b>.</li></ol>
<p class="key"><b>Why verify a download?</b> A checksum proves the file is complete and unmodified. Attackers sometimes distribute tampered installers. Always compare with the value on the <b>official</b> site.</p>`,
    setup(api) {
      const R = () => { drawAll(); api.refresh(); };
      // ---------- Windows host
      const tm = h("div", { class: "win-b" });
      const ps = Kit.shell({
        prompt: () => "PS C:\\Users\\student> ", theme: "ps", ci: true, label: "PowerShell", after: R, banner: "Windows PowerShell",
        notFound: (c) => `${c} : The term '${c}' is not recognized as the name of a cmdlet, function, script file, or operable program.`,
        commands: {
          certutil: async (a, t) => {
            const i = a.findIndex((x) => /^-hashfile$/i.test(x));
            const file = a[i + 1] || "";
            if (i < 0 || !file) return t.print("Usage: certutil -hashfile InFile [HashAlgorithm]");
            const where = /^c:\\isos\\/i.test(file) ? "isos" : /downloads/i.test(file) ? "downloads" : null;
            if (!new RegExp(ISO.replace(/\./g, "\\.") + "$", "i").test(file) || where !== S.iso) return t.print(`CertUtil: -hashfile command FAILED: 0x80070002 (WIN32: 2 ERROR_FILE_NOT_FOUND)\nCertUtil: The system cannot find the file specified.`);
            if (!/sha256/i.test(a[i + 2] || "")) t.print("(no algorithm given: certutil defaults to SHA1 — add SHA256)", "tl-dim");
            t.print("Computing hash of a 2.7 GB file…", "tl-dim"); if (!(await t.wait(1400))) return;
            const hash = /sha256/i.test(a[i + 2] || "") ? (S.corrupt ? BAD : GOOD) : "5e2a9c0f1d3b7a6e4c8f2b1d0a9e8c7b6a5f4e3d";
            t.print(`SHA256 hash of ${file}:`); t.print(hash); t.print("CertUtil: -hashfile command completed successfully.");
            S.hashed = /sha256/i.test(a[i + 2] || "") ? hash : null;
          },
          cls: (a, t) => (t.out.textContent = ""),
        },
      });
      const fe = h("div", { class: "win-b" });
      const sums = h("pre", { class: "mono-box" }, `${GOOD} *${ISO}\nb2f4…e19a *ubuntu-26.04.1-desktop-amd64.iso`);
      // ---------- VMware
      const vmw = h("div", { class: "win-b" });
      let wiz = null;
      // ---------- console (installer + Linux)
      const inst = h("div", { class: "win-b" });
      const con = new Lab.Term({
        prompt: () => (S.power !== "on" ? "" : !S.installed ? "" : !S.login ? "ubuntu-lab login: " : "student@ubuntu-lab:~$ "), theme: "linux", label: "VM console", after: R,
        exec: async (line, t) => {
          if (S.power !== "on") return t.print("(the VM is powered off — power it on in VMware)", "tl-dim");
          if (!S.installed) return t.print("(the installer is a menu — use the buttons above)", "tl-dim");
          if (!S.login) {
            const user = line.trim();
            const pw = await t.ask("Password: ", { secret: true });
            if (pw == null) return;
            await t.wait(500);
            if (user !== S.profile.user || pw !== S.profile.pass || S.layout !== "ENG US") { t.print(""); t.print("Login incorrect"); if (S.layout !== "ENG US") api.toast("Hint: the taskbar shows " + S.layout); return; }
            S.login = user; t.lines(`Welcome to Ubuntu 26.04.1 LTS (GNU/Linux 7.0.0-14-generic x86_64)\n\n * Documentation:  https://help.ubuntu.com\n\nLast login: never`); return;
          }
          const c = line.trim();
          const run = (k, out) => { S.ran.add(k); t.lines(out); };
          if (c === "lscpu") return run("lscpu", `Architecture:             x86_64\nCPU(s):                   2\n  On-line CPU(s) list:    0,1\nVendor ID:                GenuineIntel\n  Model name:             Intel(R) Core(TM) i7-12700H\nVirtualization features:\n  Hypervisor vendor:      VMware\n  Virtualization type:    full`);
          if (c === "systemd-detect-virt") return run("virt", "vmware");
          if (c === "free -h") return run("free", `               total        used        free      shared  buff/cache   available\nMem:           3.3Gi       412Mi       2.6Gi       1.1Mi       487Mi       2.9Gi\nSwap:             0B          0B          0B`);
          if (c === "lsblk") return run("lsblk", `NAME                      MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nsda                         8:0    0   20G  0 disk\n├─sda1                      8:1    0    1M  0 part\n├─sda2                      8:2    0  1.8G  0 part /boot\n└─sda3                      8:3    0 18.2G  0 part\n  └─ubuntu--vg-ubuntu--lv 252:0    0   10G  0 lvm  /\nsr0                        11:0    1  2.7G  0 rom`);
          if (c === "ip a") return run("ip", `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN\n    inet 127.0.0.1/8 scope host lo\n2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    link/ether 00:0c:29:7a:41:be brd ff:ff:ff:ff:ff:ff\n    inet 192.168.137.128/24 metric 100 brd 192.168.137.255 scope global dynamic ens33`);
          if (c === "sudo poweroff") { const p = await t.ask(`[sudo] password for ${S.login}: `, { secret: true }); if (p !== S.profile.pass) return t.print("Sorry, try again."); t.print("(the VM shuts down)", "tl-dim"); await t.wait(800); S.power = "off"; S.login = null; S.cleanOff = true; return; }
          if (c === "poweroff") return t.print("Call to PowerOff failed: Access denied (use sudo)");
          if (c === "hostname") return t.print("ubuntu-lab");
          if (c === "whoami") return t.print(S.login);
          if (c === "clear") { t.out.textContent = ""; return; }
          if (c) t.print(`${c.split(" ")[0]}: command not found`);
        },
      });
      const layoutBtn = h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { S.layout = S.layout === "ENG US" ? "ENG UK" : "ENG US"; layoutBtn.textContent = "Windows input: " + S.layout + " (Win+Space)"; } }, "Windows input: ENG US (Win+Space)");
      const consoleEl = h("div", null, h("div", { class: "row", style: "margin-block-end:.5rem" }, layoutBtn), inst, con.el);

      function drawHost() {
        tm.replaceChildren(h("p", { class: "panel-k" }, "Task Manager › Performance › CPU"),
          h("div", { class: "list" }, h("div", null, "Virtualization: ", h("b", null, S.vtx ? "Enabled" : "Disabled")), h("div", null, "Memory: 16.0 GB")),
          !S.vtx && h("button", { class: "btn btn--s", type: "button", onclick: () => { S.vtx = true; api.toast("Rebooted after enabling Intel VT-x in BIOS/UEFI"); R(); } }, "Reboot into BIOS/UEFI and enable Intel VT-x / AMD-V"));
        fe.replaceChildren(h("p", { class: "panel-k" }, "File Explorer"),
          h("div", { class: "list" }, h("div", null, "📁 Downloads ", S.iso === "downloads" && h("small", null, `· ${ISO} (2.7 GB)`)), h("div", null, "📁 C:\\ISOs ", S.iso === "isos" && h("small", null, `· ${ISO}`))),
          h("div", { class: "row" }, S.iso === "downloads" && h("button", { class: "btn btn--s", type: "button", onclick: () => { S.iso = "isos"; R(); } }, "Create C:\\ISOs and move the ISO there"),
            h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { S.corrupt = false; S.hashed = null; S.redownloaded = true; api.toast("Deleted and downloaded again from ubuntu.com"); R(); } }, "Delete ISO and download again")),
          h("p", { class: "panel-k" }, "Browser › releases.ubuntu.com/26.04.1/SHA256SUMS"), sums,
          h("div", { class: "row" }, h("span", null, "Do the two values match?"),
            h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { if (!S.hashed) return api.toast("Compute the hash first"); const m = S.hashed === GOOD; if (m) { S.verified = true; api.toast("✓ Match: the ISO is intact"); } else { S.sawMismatch = true; api.toast("✗ Different: the file is damaged or tampered — delete it and download again"); } R(); } }, "Compare")));
      }
      function drawVMware() {
        if (!S.vmw) { vmw.replaceChildren(h("p", null, "VMware Workstation Pro 26H1 installed (Parts 2–3)."), h("button", { class: "btn btn--s", type: "button", onclick: () => { S.vmw = true; R(); } }, "Open VMware Workstation")); return; }
        if (wiz) return drawWizard();
        vmw.replaceChildren(
          h("div", { class: "row" }, !S.vm && h("button", { class: "btn btn--s", type: "button", onclick: () => { wiz = { step: 0, type: "Typical", src: "iso", iso: "", name: "Ubuntu 64-bit", loc: "C:\\Users\\student\\Documents\\Virtual Machines\\Ubuntu 64-bit", disk: 20, split: "split", mem: 6144, cpus: 2, net: "NAT", d3: true, connect: true, powerOn: true }; drawWizard(); } }, "Create a New Virtual Machine")),
          S.vm && h("div", { class: "list" },
            h("div", null, h("b", null, S.vm.name), "  ", h("span", { class: "pill " + (S.power === "on" ? "pill--ok" : "") }, S.power === "on" ? "Running" : "Powered off")),
            h("div", null, `${S.vm.mem} MB · ${S.vm.cpus} CPUs · ${S.vm.disk} GB (${S.vm.split}) · ${S.vm.net} · 3D ${S.vm.d3 ? "on" : "off"} · ${S.vm.loc}`),
            h("div", null, "Snapshots: ", S.snapshots.length ? S.snapshots.map((x) => x.name).join(", ") + " · You Are Here" : "none")),
          S.vm && h("div", { class: "row" },
            S.power === "off" ? h("button", { class: "btn btn--s", type: "button", onclick: () => { S.power = "on"; if (!S.installed) S.installer = S.installer || 0; api.show("console"); R(); } }, "▶ Power on") : null,
            h("input", { type: "text", class: "wb-addr", style: "max-inline-size:11rem", placeholder: "Snapshot name", id: "snapname" }),
            h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => takeSnapshot(document.getElementById("snapname").value) }, "VM › Snapshot › Take Snapshot")));
      }
      function takeSnapshot(name) {
        if (!name || !name.trim()) return api.toast("Type a snapshot name first");
        S.snapshots.push({ name: name.trim(), off: S.power === "off" });
        api.toast(`Snapshot “${name.trim()}” taken`); R();
      }
      function drawWizard() {
        const w = wiz;
        const steps = [
          () => [h("p", { class: "panel-k" }, "New Virtual Machine Wizard — What type of configuration?"), radios("t", [["Typical", "Typical (recommended)"], ["Custom", "Custom (advanced)"]], w.type, (v) => (w.type = v))],
          () => [h("p", { class: "panel-k" }, "Install the guest operating system from:"), radios("src", [["iso", "Installer disc image file (iso)"], ["later", "I will install the operating system later"]], w.src, (v) => (w.src = v)),
            field("ISO path", h("input", { type: "text", value: w.iso, placeholder: "C:\\ISOs\\…", oninput: (e) => (w.iso = e.target.value) })), h("p", { class: "ipf-note" }, "VMware detects “Ubuntu 64-bit Server 26.04.1” and can't use Easy Install with this ISO.")],
          () => [field("Virtual machine name", h("input", { type: "text", value: w.name, oninput: (e) => (w.name = e.target.value) })), field("Location", h("input", { type: "text", value: w.loc, oninput: (e) => (w.loc = e.target.value) }))],
          () => [field("Maximum disk size (GB)", h("input", { type: "number", value: w.disk, oninput: (e) => (w.disk = +e.target.value) })), radios("split", [["single", "Store virtual disk as a single file"], ["split", "Split virtual disk into multiple files"]], w.split, (v) => (w.split = v))],
          () => [h("p", { class: "panel-k" }, "Customize Hardware"), field("Memory (MB)", h("input", { type: "number", value: w.mem, oninput: (e) => (w.mem = +e.target.value) })), field("Processors (vCPUs)", h("input", { type: "number", value: w.cpus, oninput: (e) => (w.cpus = +e.target.value) })),
            field("Network adapter", h("select", { onchange: (e) => (w.net = e.target.value) }, ["NAT", "Bridged", "Host-only"].map((n) => h("option", { selected: n === w.net }, n)))),
            h("label", { class: "row" }, h("input", { type: "checkbox", checked: w.connect, onchange: (e) => (w.connect = e.target.checked) }), "CD/DVD: Connect at power on"),
            h("label", { class: "row" }, h("input", { type: "checkbox", checked: w.d3, onchange: (e) => (w.d3 = e.target.checked) }), "Display: Accelerate 3D graphics")],
        ];
        const last = w.step === steps.length - 1;
        vmw.replaceChildren(...steps[w.step](), h("div", { class: "row" },
          h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { if (w.step) { w.step--; drawWizard(); } else { wiz = null; R(); } } }, w.step ? "< Back" : "Cancel"),
          h("button", { class: "btn btn--s", type: "button", onclick: () => {
            if (w.step === 1 && w.src === "iso" && !new RegExp(ISO.replace(/\./g, "\\.") + "$", "i").test(w.iso)) return api.toast("Point it at the ISO in C:\\ISOs");
            if (!last) { w.step++; drawWizard(); return; }
            S.vm = { name: w.name.trim(), loc: w.loc.trim(), disk: w.disk, split: w.split, mem: w.mem, cpus: w.cpus, net: w.net, d3: w.d3, connect: w.connect, iso: w.iso };
            wiz = null; api.toast("Virtual machine created"); R();
          } }, last ? "Finish" : "Next >")));
      }
      // installer screens
      const SCREENS = [
        { k: "lang", t: "Language", opts: ["English", "العربية", "Français"] },
        { k: "kbd", t: "Keyboard configuration — layout must match the keyboard you type on", opts: ["English (US)", "English (UK)", "Arabic"] },
        { k: "type", t: "Choose the type of installation", opts: ["Ubuntu Server", "Ubuntu Server (minimized)"] },
        { k: "net", t: "Network configuration — ens33: DHCPv4 192.168.137.128/24", opts: ["Done"] },
        { k: "proxy", t: "Proxy address (leave empty)", opts: ["Done (no proxy)"] },
        { k: "mirror", t: "Ubuntu archive mirror: iq.archive.ubuntu.com — This mirror location passed tests", opts: ["Done"] },
        { k: "storage", t: "Guided storage configuration", opts: ["Use an entire disk + LVM, encryption off", "Use an entire disk, no LVM", "Custom storage layout"] },
        { k: "confirm", t: "Confirm destructive action: the (virtual) disk will be formatted", opts: ["Continue", "No"] },
        { k: "profile", t: "Profile configuration", profile: true },
        { k: "pro", t: "Upgrade to Ubuntu Pro", opts: ["Skip for now", "Enable Ubuntu Pro"] },
        { k: "ssh", t: "SSH configuration", opts: ["Leave “Install OpenSSH server” unticked", "Install OpenSSH server"] },
        { k: "snaps", t: "Featured server snaps", opts: ["Select nothing — Done", "Install docker, microk8s, …"] },
        { k: "done", t: "Installation complete!", opts: ["Reboot Now"] },
      ];
      const choices = {};
      function drawInstaller() {
        if (S.power !== "on" || S.installed || S.installer == null) { inst.replaceChildren(S.installed ? h("p", { class: "ipf-note" }, "Ubuntu is installed. Log in below.") : h("p", { class: "ipf-note" }, S.vm ? "Power on the VM in VMware to start the installer." : "Create the VM first.")); return; }
        if (S.vtx === false) { inst.replaceChildren(h("p", { class: "dialog dialog--bad" }, "This host supports Intel VT-x, but Intel VT-x is disabled. (Enable it in BIOS/UEFI first.)")); return; }
        const sc = SCREENS[S.installer];
        if (sc.profile) {
          const pf = { name: "", server: "", user: "", pass: "", pass2: "" };
          const inp = (k, label, type = "text") => field(label, h("input", { type, oninput: (e) => (pf[k] = e.target.value) }));
          inst.replaceChildren(h("p", { class: "panel-k" }, `Installer ${S.installer + 1}/${SCREENS.length} · ${sc.t}`), inp("name", "Your name"), inp("server", "Your server's name"), inp("user", "Pick a username"), inp("pass", "Choose a password", "password"), inp("pass2", "Confirm your password", "password"),
            h("button", { class: "btn btn--s", type: "button", onclick: () => {
              if (!pf.name || !pf.server || !pf.user || !pf.pass) return api.toast("All fields are required");
              if (pf.pass !== pf.pass2) return api.toast("Passwords do not match");
              choices.profile = { ...pf }; S.profile = { user: pf.user.trim(), pass: pf.pass, server: pf.server.trim() }; S.installer++; R();
            } }, "Done"));
          return;
        }
        inst.replaceChildren(h("p", { class: "panel-k" }, `Installer ${S.installer + 1}/${SCREENS.length} · keyboard only in real life`), h("p", null, h("b", null, sc.t)),
          h("div", { style: "display:grid;gap:.35rem" }, sc.opts.map((o) => h("button", { class: "btn btn--ghost btn--s", style: "justify-content:flex-start", type: "button", onclick: async () => {
            choices[sc.k] = o;
            if (sc.k === "confirm" && o === "No") { S.installer = 6; return R(); }
            if (sc.k === "done") { inst.replaceChildren(h("p", null, "Please remove the installation medium, then press ENTER… (VMware ejects the ISO)")); await Lab.sleep(900); S.installed = true; con.print("ubuntu-lab login: prompt ready", "tl-dim"); con.setPrompt(); return R(); }
            if (sc.k === "storage") { inst.replaceChildren(h("p", null, "Storage summary: / 10G (ext4, LVM ubuntu-lv) · /boot 1.8G · ubuntu-vg ~18G (≈8G free)")); await Lab.sleep(700); }
            S.installer++; R();
          } }, "[ " + o + " ]"))));
      }
      function drawAll() { drawHost(); drawVMware(); drawInstaller(); con.setPrompt(); }
      api.termOf = (id) => (id === "host" ? ps : id === "console" ? con : null);
      api.stage.append(api.dock());
      api.device("host", "Windows PC", "Task Manager · PowerShell", h("div", null, win("Task Manager", null, tm), win("Files and browser", null, fe), h("p", { class: "panel-k", style: "margin:.6rem 0 .3rem" }, "Windows PowerShell"), ps.el));
      api.device("vmware", "VMware", "Workstation Pro", win("VMware Workstation Pro", "Home · Library", vmw));
      api.device("console", "ubuntu-lab", "VM console", consoleEl);
      drawAll();
      S._choices = choices;
    },
    tasks: [
      { title: "Part 1 · Make sure virtualization is enabled", detail: "Task Manager › Performance › CPU must say Virtualization: Enabled.", where: "Windows PC", check: () => S.vtx },
      { title: "Part 1 · Move the ISO into C:\\ISOs", detail: "A short path without spaces avoids trouble later.", where: "Windows PC › Files", check: () => S.iso === "isos" },
      { title: "Part 1 · Verify the ISO's SHA-256", detail: "Compute the hash and compare it with the official SHA256SUMS. If they differ, delete the file and download again, then re-check.", where: "Windows PC › PowerShell",
        answer: `certutil -hashfile C:\\ISOs\\${ISO} SHA256`, device: "host", type: `certutil -hashfile C:\\ISOs\\${ISO} SHA256`, check: () => S.verified && S.sawMismatch },
      { title: "Part 4 · Create the VM with the lab's plan", detail: "ubuntu-lab in C:\\VMs\\ubuntu-lab, 20 GB split, 4096 MB, 2 CPUs, NAT, 3D off, CD/DVD connected at power on.", where: "VMware",
        hint: "VMware suggests 6144 MB and a path under Documents — change both.", check: () => { const v = S.vm; return v && v.name === "ubuntu-lab" && /^c:\\vms\\ubuntu-lab\\?$/i.test(v.loc) && v.disk === 20 && v.split === "split" && v.mem === 4096 && v.cpus === 2 && v.net === "NAT" && !v.d3 && v.connect; } },
      { title: "Part 5 · Install Ubuntu Server with the lab's choices", detail: "English, English (US) keyboard, standard Ubuntu Server, entire disk + LVM without encryption, server name ubuntu-lab, user student, Pro skipped, SSH off, no snaps.", where: "ubuntu-lab console",
        check: () => { const c = S._choices || {}; return S.installed && c.kbd === "English (US)" && c.type === "Ubuntu Server" && /LVM, encryption off/.test(c.storage || "") && c.profile?.server === "ubuntu-lab" && c.profile?.user === "student" && c.pro === "Skip for now" && /unticked/.test(c.ssh || "") && /nothing/.test(c.snaps || ""); } },
      { title: "Part 6 · Log in as student", detail: "If a correct password is rejected, check the Windows input language on the taskbar.", where: "ubuntu-lab console", check: () => S.login === "student" || S.cleanOff },
      { title: "Part 6 · Prove it's a VM", detail: "Run lscpu, systemd-detect-virt, free -h, lsblk and ip a.", where: "ubuntu-lab console", device: "console",
        type: () => ["lscpu", "systemd-detect-virt", "free -h", "lsblk", "ip a"][["lscpu", "virt", "free", "lsblk", "ip"].findIndex((k) => !S.ran.has(k))] || "", check: () => S.ran.size >= 5 },
      { title: "Part 6 · Shut down cleanly", where: "ubuntu-lab console", answer: "sudo poweroff", device: "console", type: "sudo poweroff", check: () => S.cleanOff },
      { title: "Part 6 · Take the snapshot “clean-install”", detail: "On the powered-off VM: VM › Snapshot › Take Snapshot.", where: "VMware", check: () => S.snapshots.some((x) => x.name === "clean-install" && x.off) },
    ],
    doneText: "Verified ISO, a correctly sized VM, a clean install, proof it runs on VMware, and a clean-install restore point — the full Lab 3.",
    quiz: [
      { t: "mcq", q: "Where do you check that virtualization is enabled on Windows?", opts: ["Task Manager › Performance › CPU (Virtualization: Enabled)", "Control Panel › Sound", "VMware › Help", "Device Manager › Printers"], a: 0, src: "Cloud Lab 3, Part 1 step 1" },
      { t: "cmd", q: "Which command computes the ISO's SHA-256 in PowerShell?", a: [`certutil -hashfile C:\\ISOs\\${ISO} SHA256`, /^certutil\s+-hashfile\s+\S+\s+sha256$/i], src: "Cloud Lab 3, Part 1 step 11" },
      { t: "short", q: "Why verify the checksum, and against what?", model: "It proves the file is complete and unmodified (a damaged ISO can fail mid-install, and attackers sometimes distribute tampered installers). Compare against the value published on the official site, not one from a third party.",
        keys: [["complete", "unmodified", "corrupt", "damaged"], ["tamper", "attacker", "modified"], ["official"]], src: "Cloud Lab 3, Part 1 “Why verify a download?”" },
      { t: "match", q: "Match each VM setting to the lab plan.", pairs: [["Memory", "4096 MB"], ["Processors", "2 vCPUs"], ["Disk", "20 GB, split into multiple files"], ["Network", "NAT"], ["3D graphics", "Off"]], src: "Cloud Lab 3, Part 4" },
      { t: "mcq", q: "Why NAT for the lab VM?", opts: ["The VM shares the host's internet connection and has a private address — the safest default", "It makes the VM reachable from the whole LAN", "It disables the network", "It's faster than bridged"], a: 0, src: "Cloud Lab 3, Part 4 step 14; Cloud Lecture 4 network modes" },
      { t: "mcq", q: "A correct password gives “Login incorrect”. What's the likely cause in the lab?", opts: ["The Windows input language was ENG UK instead of ENG US", "The VM has no network", "The disk is full", "SSH is disabled"], a: 0, src: "Cloud Lab 3, Part 6 steps 3–4" },
      { t: "match", q: "Match each command to what it proves.", pairs: [["lscpu", "Hypervisor vendor: VMware, 2 CPUs"], ["systemd-detect-virt", "Prints one word: vmware"], ["free -h", "About 3.3 GiB total memory"], ["lsblk", "20 GB sda, / on LVM"], ["ip a", "ens33 UP with a private NAT address"]], src: "Cloud Lab 3, Part 6" },
      { t: "mcq", q: "Why take the snapshot of a powered-off VM?", opts: ["It is small and consistent", "Running VMs can't have snapshots", "It deletes old data", "It speeds up the CPU"], a: 0, src: "Cloud Lab 3, Part 6 “Power off cleanly before the snapshot”" },
      { t: "order", q: "Order the recovery-mode password reset steps (text-only in this lab).", items: ["Restart and open GRUB (Shift or Esc)", "Advanced options › recovery mode", "root — drop to root shell", "mount -o remount,rw /", "passwd student", "reboot"], src: "Cloud Lab 3, Part 6 “Forgot the password?”" },
      { t: "tf", q: "The Ubuntu Server installer formats your Windows disk.", a: false, why: "It only erases the virtual disk.", src: "Cloud Lab 3, Part 5" },
    ],
  });
})();
