// Cloud Computing · Lab 4 — Clone, Export, and Import Virtual Machines (VMware Workstation).
(() => {
  const { h } = Lab;
  const { field, radios, win } = Kit;
  const mid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const PARENT_ID = mid();
  const vm = (o) => ({ state: "off", snapshots: [], cd: true, sound: true, pass: "lab123", host: "ubuntu-lab", machineId: PARENT_ID, size: "4.9 GB", ...o });
  const VMS = { "ubuntu-lab": vm({ name: "ubuntu-lab", path: "C:\\VMs\\ubuntu-lab", state: "on", snapshots: ["clean-install"] }) };
  const S = { sel: "ubuntu-lab", boot: null, login: null, rootShell: false, rw: false, exportFiles: null, flags: {} };
  const F = S.flags;

  Lab.start({
    brief: `
<p>Install once, then copy: make a <b>linked clone</b> and a <b>full clone</b> from the <b>clean-install</b> snapshot, fix what a clone inherits, recover a lost password in <b>recovery mode</b>, then move a VM with <b>OVF</b> export and import.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th></th><th>Linked clone</th><th>Full clone</th></tr>
<tr><td>What it is</td><td>Points to the parent's disk, stores only its own changes</td><td>A complete, separate copy of the disk</td></tr>
<tr><td>Disk space</td><td>Very small</td><td>About the parent's used data</td></tr>
<tr><td>Speed</td><td>Seconds</td><td>Longer: the disk is copied</td></tr>
<tr><td>Independence</td><td>Needs the parent's files</td><td>Fully independent</td></tr>
<tr><td>Best for</td><td>Quick labs and tests</td><td>Backups, moving, long-term use</td></tr></table></div>
<div class="tbl-wrap"><table class="tbl"><tr><th>OVF export file</th><th>Holds</th></tr>
<tr><td>.ovf</td><td>XML description: CPU, memory, disks, network</td></tr><tr><td>.vmdk</td><td>The virtual disk</td></tr><tr><td>.mf</td><td>Manifest: SHA checksums</td></tr><tr><td>.iso</td><td>Only if a CD/DVD image was still attached</td></tr></table></div>
<p class="note"><b>Security:</b> a clone inherits everything — password, SSH keys, hostname and machine ID. An exported VM carries its whole disk, users and data. Lab login: <code>student / lab123</code>.</p>`,
    setup(api) {
      const R = () => { draw(); api.refresh(); };
      const lib = h("div", { class: "win-b" });
      const side = h("div", { class: "win-b" });
      const grub = h("div");
      const con = new Lab.Term({
        prompt: () => { const v = VMS[S.boot]; if (!v) return ""; if (S.rootShell) return "root@ubuntu-lab:~# "; return S.login ? `student@${v.host}:~$ ` : `${v.host} login: `; },
        theme: "linux", label: "VM console", after: R,
        exec: async (line, t) => {
          const v = VMS[S.boot];
          if (!v) return t.print("(no VM is running — power one on in the Library)", "tl-dim");
          if (S.grub) return t.print("(GRUB menu: use the buttons above)", "tl-dim");
          const c = line.trim();
          if (S.rootShell) {
            if (c === "mount -o remount,rw /") { S.rw = true; return; }
            if (c === "ls /home") return t.print("student");
            if (/^passwd\s+student$/.test(c)) {
              if (!S.rw) return t.lines("New password:\nRetype new password:\npasswd: Authentication token manipulation error\npasswd: password unchanged   (the file system is read-only — remount it rw)");
              const a = await t.ask("New password: ", { secret: true }); if (a == null) return;
              const b = await t.ask("Retype new password: ", { secret: true }); if (b == null) return;
              if (!a || a !== b) return t.print("Sorry, passwords do not match.\npasswd: password unchanged");
              v.pass = a; F.reset = S.boot; return t.print("passwd: password updated successfully");
            }
            if (c === "reboot") { S.rootShell = false; S.rw = false; S.login = null; t.print("(rebooting…)", "tl-dim"); await t.wait(700); return; }
            if (c) return t.print(`${c.split(" ")[0]}: command not found`);
            return;
          }
          if (!S.login) {
            const pw = await t.ask("Password: ", { secret: true }); if (pw == null) return;
            await t.wait(400);
            if (c !== "student" || pw !== v.pass) return t.print("\nLogin incorrect");
            S.login = "student"; return t.print(`Welcome to Ubuntu 26.04.1 LTS`);
          }
          const sudo = async () => { if (S.sudoOk) return true; const p = await t.ask("[sudo] password for student: ", { secret: true }); if (p !== v.pass) { t.print("Sorry, try again."); return false; } S.sudoOk = true; return true; };
          let m;
          if ((m = /^sudo hostnamectl set-hostname (\S+)$/.exec(c))) { if (!(await sudo())) return; v.host = m[1]; return; }
          if (c === "hostnamectl") return t.lines(` Static hostname: ${v.host}\n       Icon name: computer-vm\n          Chassis: vm 🖴\n      Machine ID: ${v.machineId}\n  Virtualization: vmware\nOperating System: Ubuntu 26.04.1 LTS`);
          if (c === "cat /etc/machine-id") return t.print(v.machineId || "cat: /etc/machine-id: No such file or directory");
          if (c === "sudo rm /etc/machine-id") { if (!(await sudo())) return; v.machineId = ""; return; }
          if (c === "sudo systemd-machine-id-setup") { if (!(await sudo())) return; if (v.machineId) return t.print("Machine ID already set."); v.machineId = mid(); return t.print(`Initializing machine ID from random generator.`); }
          if (c === "ip a") return t.lines(`2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    link/ether 00:0c:29:${v.name.length.toString(16).padStart(2, "0")}:5e:c${v.name.length % 10} brd ff:ff:ff:ff:ff:ff\n    inet 192.168.137.${120 + v.name.length}/24 scope global dynamic ens33`);
          if (c === "sudo poweroff") { if (!(await sudo())) return; t.print("(shutting down)", "tl-dim"); await t.wait(600); v.state = "off"; S.boot = null; S.login = null; S.sudoOk = false; if (v.name === "ubuntu-lab") F.parentOff = true; return; }
          if (c === "clear") { t.out.textContent = ""; return; }
          if (c) t.print(`${c.split(" ")[0]}: command not found`);
        },
      });
      function boot(name) {
        const v = VMS[name];
        if (S.boot && S.boot !== name) return api.toast("One VM at a time in this simulator: power off the running one first");
        if (v.linkedTo && !VMS[v.linkedTo]) return api.toast("Cannot open the parent virtual disk: the linked clone needs its parent's files");
        v.state = "on"; S.boot = name; S.login = null; S.sudoOk = false;
        con.print("");
        con.print(name.startsWith("ubuntu-lab-") && !F[`seenHints${name}`] ? "VMware: Side channel mitigations hint → OK · Removable devices hint → OK" : "", "tl-dim");
        F[`seenHints${name}`] = true;
        api.show("console"); R();
      }
      // ---- GRUB / recovery
      function drawGrub() {
        if (!S.grub) { grub.replaceChildren(); return; }
        const opt = (t, fn) => h("button", { class: "btn btn--ghost btn--s", style: "justify-content:flex-start", type: "button", onclick: fn }, t);
        const scr = {
          main: [opt("*Ubuntu", () => { S.grub = null; R(); }), opt("Advanced options for Ubuntu", () => { S.grub = "adv"; R(); })],
          adv: [opt("Ubuntu, with Linux 7.0.0-14-generic", () => { S.grub = null; R(); }), opt("Ubuntu, with Linux 7.0.0-14-generic (recovery mode)", () => { S.grub = "rec"; R(); })],
          rec: [opt("resume — Resume normal boot", () => { S.grub = null; R(); }), opt("fsck — Check all file systems", () => {}), opt("root — Drop to root shell prompt", () => { S.grub = null; S.rootShell = true; S.rw = false; con.print("Press Enter for maintenance (or press Control-D to continue):", "tl-dim"); R(); })],
        }[S.grub];
        grub.replaceChildren(h("div", { class: "dialog" }, h("p", { class: "dialog-t" }, { main: "GNU GRUB", adv: "GNU GRUB › Advanced options", rec: "Recovery Menu (filesystem state: read-only)" }[S.grub]), ...scr));
      }
      // ---- clone wizard / export / import
      let wiz = null;
      function drawSide() {
        const v = VMS[S.sel];
        if (wiz?.kind === "clone") {
          const w = wiz;
          side.replaceChildren(h("p", { class: "panel-k" }, `Clone Virtual Machine Wizard — ${v.name}`),
            h("p", { class: "panel-k" }, "Clone from"), radios("src", [["current", "The current state in the virtual machine"], ["snap", "An existing snapshot: clean-install"]], w.src, (x) => (w.src = x)),
            h("p", { class: "panel-k" }, "Clone method"), radios("type", [["linked", "Create a linked clone", "Needs less disk space, can't run without the original"], ["full", "Create a full clone", "Complete copy, fully independent, more space and time"]], w.type, (x) => (w.type = x)),
            field("Virtual machine name", h("input", { type: "text", value: w.name, oninput: (e) => (w.name = e.target.value) })),
            field("Location", h("input", { type: "text", value: w.loc, oninput: (e) => (w.loc = e.target.value) })),
            h("div", { class: "row" }, h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { wiz = null; R(); } }, "Cancel"), h("button", { class: "btn btn--s", type: "button", onclick: () => doClone() }, "Finish")));
          return;
        }
        if (wiz?.kind === "export") {
          const w = wiz;
          side.replaceChildren(h("p", { class: "panel-k" }, `File › Export to OVF… — ${v.name}`), field("Folder", h("input", { type: "text", value: w.folder, oninput: (e) => (w.folder = e.target.value) })), field("File name (no extension = OVF folder, .ova = one file)", h("input", { type: "text", value: w.file, oninput: (e) => (w.file = e.target.value) })),
            h("div", { class: "row" }, h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { wiz = null; R(); } }, "Cancel"), h("button", { class: "btn btn--s", type: "button", onclick: () => doExport() }, "Save")));
          return;
        }
        if (wiz?.kind === "import") {
          const w = wiz;
          side.replaceChildren(h("p", { class: "panel-k" }, "Import Virtual Machine (File › Open → .ovf)"), field("Name for the new virtual machine", h("input", { type: "text", value: w.name, oninput: (e) => (w.name = e.target.value) })), field("Storage path", h("input", { type: "text", value: w.path, oninput: (e) => (w.path = e.target.value) })),
            h("div", { class: "row" }, h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { wiz = null; R(); } }, "Cancel"), h("button", { class: "btn btn--s", type: "button", onclick: () => doImport() }, "Import")));
          return;
        }
        side.replaceChildren(h("p", { class: "panel-k" }, `Details — ${v.name}`),
          h("div", { class: "list" },
            h("div", null, "State: ", h("b", null, v.state === "on" ? "Powered on" : "Powered off")),
            h("div", null, `Configuration file: ${v.path}\\${v.name}.vmx`),
            v.linkedTo && h("div", null, h("b", null, `Clone of: C:\\VMs\\${v.linkedTo}\\${v.linkedTo}.vmx`)),
            h("div", null, `4 GB memory · 2 processors · 20 GB disk · NAT${v.sound ? " · Sound Card" : ""} · CD/DVD: ${v.cd ? "connected (ubuntu ISO)" : "disconnected"}`),
            h("div", null, `Snapshots: ${v.snapshots.join(", ") || "none"} · Files on disk: ${v.size}`)),
          h("div", { class: "row" },
            v.state === "off" ? h("button", { class: "btn btn--s", type: "button", onclick: () => boot(v.name) }, "▶ Power on") : h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { if (S.boot === v.name) { S.grub = "main"; S.login = null; S.rootShell = false; api.show("console"); con.print("(VM › Power › Restart Guest — press Esc for GRUB)", "tl-dim"); R(); } } }, "Restart Guest → GRUB"),
            h("button", { class: "btn btn--ghost btn--s", type: "button", disabled: v.state !== "off", title: v.state !== "off" ? "Grayed out: the VM is running" : "", onclick: () => { wiz = { kind: "clone", src: "current", type: "linked", name: `Clone of ${v.name}`, loc: `C:\\Users\\student\\Documents\\Virtual Machines\\Clone of ${v.name}` }; R(); } }, "Manage › Clone…"),
            h("button", { class: "btn btn--ghost btn--s", type: "button", disabled: v.state !== "off", onclick: () => { wiz = { kind: "export", folder: "C:\\ISOs", file: v.name }; R(); } }, "File › Export to OVF…"),
            h("button", { class: "btn btn--ghost btn--s", type: "button", disabled: v.state !== "off", onclick: () => { v.cd = !v.cd; R(); } }, v.cd ? "Settings › disconnect CD/DVD" : "Settings › connect CD/DVD")),
          S.exportFiles && h("div", null, h("p", { class: "panel-k" }, `Exported: ${S.exportFiles.folder}`), h("div", { class: "list" }, S.exportFiles.files.map(([f, sz, job]) => h("div", null, h("b", null, f), ` · ${sz} · ${job}`))),
            h("button", { class: "btn btn--s", type: "button", onclick: () => { wiz = { kind: "import", name: "ubuntu-lab-imported", path: "C:\\VMs\\Imported" }; R(); } }, "File › Open… (select the .ovf)")));
      }
      async function doClone() {
        const v = VMS[S.sel], w = wiz, name = w.name.trim();
        if (VMS[name]) return api.toast("A VM with that name exists");
        if (w.src === "current" && w.type === "linked") api.toast("A linked clone of the current state creates a new snapshot on the parent");
        wiz = null; R();
        api.toast(w.type === "full" ? "Creating full clone… (the disk is really copied)" : "Creating linked clone… done in seconds");
        await Lab.sleep(w.type === "full" ? 1800 : 300);
        VMS[name] = vm({ name, path: w.loc.trim(), linkedTo: w.type === "linked" ? v.name : null, size: w.type === "linked" ? "≈ 200 MB" : "≈ 4.9 GB", src: w.src, pass: w.type === "full" ? Lab.shuffle([..."q7Zk2mPx9"]).join("") : v.pass, host: v.host, machineId: v.machineId, cd: v.cd });
        S.sel = name; R();
      }
      async function doExport() {
        const v = VMS[S.sel], w = wiz;
        const ova = /\.ova$/i.test(w.file.trim());
        wiz = null; api.toast("Exporting… (about 4 minutes in real life)"); await Lab.sleep(1200);
        const base = w.file.trim().replace(/\.ova$/i, "");
        S.exportFiles = { folder: w.folder.trim(), ova, from: v.name, cd: v.cd, files: ova ? [[base + ".ova", v.cd ? "≈ 5.4 GB" : "≈ 2.7 GB", "OVF package in one file"]] : [[base + ".ovf", "12 KB", "Hardware description (XML)"], [base + "-disk1.vmdk", "≈ 2.7 GB", "The virtual disk"], ...(v.cd ? [[base + "-file1.iso", "≈ 2.7 GB", "The install DVD that was still attached"]] : []), [base + ".mf", "1 KB", "SHA checksums"]] };
        R();
      }
      async function doImport() {
        const w = wiz, name = w.name.trim();
        if (!S.exportFiles || S.exportFiles.ova) { api.toast("Select the .ovf of an OVF folder export"); return; }
        const src = VMS[S.exportFiles.from];
        wiz = null; api.toast("Importing… (about 1 minute)"); await Lab.sleep(1000);
        VMS[name] = vm({ name, path: w.path.trim(), sound: false, snapshots: [], linkedTo: null, pass: src.pass, host: src.host, machineId: src.machineId, cd: S.exportFiles.cd, size: "≈ 4.9 GB", imported: true });
        S.sel = name; R();
      }
      function drawLib() {
        lib.replaceChildren(h("p", { class: "panel-k" }, "Library"), h("div", { class: "list" }, Object.values(VMS).map((v) => h("div", { class: v.name === S.sel ? "sel" : "" },
          h("button", { type: "button", class: "wb-hrow", onclick: () => { S.sel = v.name; wiz = null; R(); } }, `${v.state === "on" ? "🟢" : "⚪"} ${v.name}${v.linkedTo ? "  (linked)" : ""}${v.imported ? "  (imported)" : ""}`)))));
      }
      function draw() { drawLib(); drawSide(); drawGrub(); con.setPrompt(); }
      api.termOf = (id) => (id === "console" ? con : null);
      api.stage.append(api.dock());
      api.device("vmware", "VMware", "Library", win("VMware Workstation Pro", null, lib, side));
      api.device("console", "Console", "running VM", h("div", null, grub, con.el));
      S.boot = "ubuntu-lab"; S.login = null;
      con.print("ubuntu-lab is running (logged out).", "tl-dim");
      draw();
    },
    tasks: [
      { title: "Shut the parent down properly", detail: "Clone is grayed out while the VM runs. Log in (student / lab123) and power off cleanly — never just close the window.", where: "Console", answer: "student\nlab123\nsudo poweroff", device: "console", type: () => (S.login ? "sudo poweroff" : "student"), check: () => F.parentOff },
      { title: "Make a linked clone from the clean-install snapshot", detail: "Name it <b>ubuntu-lab-linked</b> and keep it in <b>C:\\VMs</b>.", where: "VMware › Manage › Clone",
        check: () => { const v = VMS["ubuntu-lab-linked"]; return v && v.linkedTo === "ubuntu-lab" && v.src === "snap" && /^c:\\vms\\/i.test(v.path); } },
      { title: "Make a full clone from the same snapshot", detail: "Name it <b>ubuntu-lab-full</b> in C:\\VMs. Compare the details: the full clone has no “Clone of” line.", where: "VMware",
        check: () => { const v = VMS["ubuntu-lab-full"]; return v && !v.linkedTo && v.src === "snap" && /^c:\\vms\\/i.test(v.path); } },
      { title: "Someone changed the full clone's password: reset it in recovery mode", detail: "Power on ubuntu-lab-full, use <b>Restart Guest → GRUB</b>, then Advanced options › recovery mode › root.", where: "VMware + Console",
        hint: "In the root shell: mount -o remount,rw /, ls /home, passwd student, reboot.", answer: "mount -o remount,rw /\nls /home\npasswd student\nreboot",
        device: "console", type: () => (S.rootShell ? (S.rw ? "passwd student" : "mount -o remount,rw /") : ""), check: () => F.reset === "ubuntu-lab-full" },
      { title: "Fix what the clone inherited: hostname and machine ID", detail: "Log in with the new password, rename it <b>ubuntu-lab-full</b>, and regenerate /etc/machine-id so it differs from the parent's.", where: "Console",
        answer: "sudo hostnamectl set-hostname ubuntu-lab-full\nsudo rm /etc/machine-id\nsudo systemd-machine-id-setup\nhostnamectl", device: "console",
        type: () => { const v = VMS["ubuntu-lab-full"]; return !v || !S.login ? "" : v.host !== "ubuntu-lab-full" ? "sudo hostnamectl set-hostname ubuntu-lab-full" : v.machineId === PARENT_ID ? "sudo rm /etc/machine-id" : !v.machineId ? "sudo systemd-machine-id-setup" : "hostnamectl"; },
        check: () => { const v = VMS["ubuntu-lab-full"]; return v && v.host === "ubuntu-lab-full" && v.machineId && v.machineId !== PARENT_ID; } },
      { title: "Export ubuntu-lab-full to an OVF folder — without the 2.7 GB ISO", detail: "Power it off, disconnect the CD/DVD, then File › Export to OVF into <b>C:\\VMs\\Exports</b>.", where: "VMware",
        hint: "A name without .ova gives an OVF folder of files.", check: () => S.exportFiles && !S.exportFiles.ova && !S.exportFiles.cd && /^c:\\vms\\exports\\?$/i.test(S.exportFiles.folder) && S.exportFiles.from === "ubuntu-lab-full" },
      { title: "Import it as ubuntu-lab-imported in C:\\VMs\\Imported", detail: "Workstation imports through File › Open. Then note what changed.", where: "VMware",
        check: () => { const v = VMS["ubuntu-lab-imported"]; return v && /^c:\\vms\\imported\\?$/i.test(v.path); } },
    ],
    doneText: "Linked vs full clones, a recovery-mode reset, the inherited identity fixed, and a VM moved with OVF — what Lab 4 asks for.",
    quiz: [
      { t: "mcq", q: "Why is a linked clone faster and smaller than a full clone? What's its main risk?", opts: ["It points to the parent's disk and stores only its own changes; it can't run if the parent's files are moved or deleted", "It compresses the disk; it's slower to boot", "It skips the OS; it can't use the network", "It's encrypted; the key can be lost"], a: 0, src: "Cloud Lab 4, Review Q1" },
      { t: "mcq", q: "30 students need identical VMs on PCs with little disk space. Which clone type?", opts: ["Linked clones — seconds to create and very small", "Full clones", "OVA exports", "Snapshots only"], a: 0, src: "Cloud Lab 4, Review Q2" },
      { t: "match", q: "Name the files of an OVF export and their job.", pairs: [[".ovf", "XML hardware description"], [".vmdk", "The virtual disk"], [".mf", "SHA checksums (manifest)"], [".iso", "A CD/DVD image, only if one was attached"]], src: "Cloud Lab 4, Review Q3" },
      { t: "multi", q: "What did the imported VM lose compared with the original? (Choose all that apply)", opts: ["The Sound Card", "Its snapshots", "The “Clone of” line", "Its 4 GB memory", "Its 20 GB disk"], a: [0, 1, 2], src: "Cloud Lab 4, Review Q4; Step 12 “What changed”" },
      { t: "short", q: "A clone keeps the parent's password and machine ID. Why is that a problem, and how do you fix it?", model: "Anyone who knows the parent's password can log in to every clone, and two machines with the same machine ID confuse DHCP and monitoring. Change the password and hostname, and regenerate the ID: sudo rm /etc/machine-id, then sudo systemd-machine-id-setup.",
        keys: [["password"], ["machine id", "machine-id"], ["dhcp", "monitoring", "confuse"], ["systemd-machine-id-setup", "regenerate", "rm /etc/machine-id"]], src: "Cloud Lab 4, Review Q5; step after Fix the hostname" },
      { t: "order", q: "Order the recovery-mode password reset.", items: ["Restart the guest and press Esc for GRUB", "Advanced options for Ubuntu", "Choose the (recovery mode) entry", "root — Drop to root shell prompt", "mount -o remount,rw /", "passwd student", "reboot"], src: "Cloud Lab 4, Password recovery" },
      { t: "mcq", q: "Why must you run <code>mount -o remount,rw /</code> before <code>passwd</code>?", opts: ["The recovery root shell starts with a read-only file system", "To mount the ISO", "To enable networking", "To create the home folder"], a: 0, src: "Cloud Lab 4, Drop to a Root Shell" },
      { t: "mcq", q: "Why is the export folder huge, and how do you fix it?", opts: ["The install ISO is still attached — disconnect the CD/DVD and export again", "The VM is running — pause it", "OVF always doubles the disk — use OVA", "Snapshots are included — delete them"], a: 0, src: "Cloud Lab 4, Troubleshooting" },
      { t: "tf", q: "Anyone with access to the VM can reset its password in recovery mode.", a: true, why: "That's why real servers use disk encryption and a GRUB password.", src: "Cloud Lab 4, password recovery security note" },
      { t: "mcq", q: "How does VMware Workstation import an OVF?", opts: ["File › Open… and select the .ovf (there is no Import command)", "File › Import", "VM › Snapshot › Import", "Drag the .mf onto the desktop"], a: 0, src: "Cloud Lab 4, Step 11" },
    ],
  });
})();
