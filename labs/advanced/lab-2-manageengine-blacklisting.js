// Advanced Cybersecurity · Experiment 2 — Blacklisting with ManageEngine Endpoint Central (Application Control).
(() => {
  const { h } = Lab;
  const { field, radios, win } = Kit;
  const HASH = "4E1A7C2B9D03F58E6A11C4D7B2E90F3AC85D6E7F1029384756AB3CD4EF0A9B71";
  const PATH = "C:\\Users\\DEEL\\OneDrive\\Desktop\\Testapp.exe";
  const S = {
    account: false, agentDl: false, agent: false, groups: [], custom: [], deps: [], sync: "—",
    view: "home", runs: [], audit: [],
  };
  const flag = {};
  const FILES = { "Testapp.exe": { folder: "C:\\Users\\DEEL\\OneDrive\\Desktop", hash: HASH, vendor: null }, "notepad.exe": { folder: "C:\\Windows\\System32", hash: "5A1D8F0C7B6E2D93A4F1C8E7B2D90A6F3E1C5B7D9A2F4E6C8B0D1A3C5E7F9B2D", vendor: "Microsoft Corporation" } };

  // the policy as the endpoint's agent last received it
  function effective() {
    if (!S.agent) return [];
    return S.deps.filter((d) => d.synced && S.custom.find((c) => c.name === d.group)?.members.includes("Dell-5320"));
  }
  function verdict(app) {
    const f = FILES[app];
    for (const d of effective()) for (const gn of d.apps) {
      const g = S.groups.find((x) => x.name === gn);
      if (!g) continue;
      const hit = g.type === "File Hash" ? g.value.replace(/\s/g, "").toUpperCase() === f.hash
        : g.type === "Product Name" ? g.value.trim().toLowerCase() === app.toLowerCase()
        : g.type === "Folder Path" ? f.folder.toLowerCase().startsWith(g.value.trim().replace(/\\\*?$/, "").toLowerCase()) && g.value.trim().length > 3
        : g.type === "Trusted Vendors" ? !!f.vendor && f.vendor.toLowerCase().includes(g.value.trim().toLowerCase()) && g.value.trim().length > 2 : false;
      if (hit) return { block: d.mode === "Strict", audit: d.mode === "Audit", group: g.name };
    }
    return { block: false };
  }

  Lab.start({
    brief: `
<p>Use <b>ManageEngine Endpoint Central</b>'s Application Control as a centralised “remote commander”: block an application on a Windows 11 computer <b>from the web console</b>, with no local configuration on that computer. Then compare it with AppLocker, the local “guard”.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>Dimension</th><th>Endpoint Central (this lab)</th><th>AppLocker (built in)</th></tr>
<tr><td>Management</td><td>Centralised: configure in the web console, pushed automatically</td><td>Local / Group Policy on each computer or via AD</td></tr>
<tr><td>Scope</td><td>Many computers in an enterprise, unified policy and reporting</td><td>A single computer, or an existing AD domain</td></tr>
<tr><td>Rules</td><td>Very rich: trusted vendors, product names, verified executables, file hashes, folder paths</td><td>Basic: publisher, path, file hash</td></tr>
<tr><td>Extras</td><td>Endpoint Privilege Management and more</td><td>Execution control only</td></tr></table></div>
<p class="key">In this lab the target is <b>Testapp.exe</b> (a Word file renamed to .exe) on the Desktop of <b>Dell-5320</b>. You block it by its <b>file hash</b>, obtained with PowerShell <code>Get-FileHash</code>.</p>
<h3>Enforcement modes</h3>
<ul><li><b>Audit</b>: for safe testing. Blocked apps still run, but attempts are logged.</li><li><b>Strict</b>: full enforcement. Blocked apps will not run.</li></ul>
<p>Two windows: the <b>Endpoint Central</b> web console (your admin browser) and the <b>Dell-5320</b> endpoint.</p>`,
    setup(api) {
      const topo = new api.Topo({
        w: 340, h: 150, label: "Cloud console managing one Windows endpoint",
        nodes: [{ id: "cloud", kind: "cloud", label: "Endpoint Central", sub: "Cloud console", x: 80, y: 60 }, { id: "pc", kind: "laptop", label: "Dell-5320", sub: "Windows 11 + agent", x: 260, y: 60 }],
        links: [{ a: "cloud", b: "pc" }], onClick: (id) => api.show(id === "cloud" ? "console" : "endpoint"),
      });
      const note = h("p", { class: "topo-note" });
      const dialog = h("div");
      api.stage.append(h("div", null, topo.el, note), dialog);
      const refresh = () => { draw(); api.refresh(); };
      function popup(title, text, bad) {
        dialog.replaceChildren(h("div", { class: "dialog" + (bad ? " dialog--bad" : "") }, h("p", { class: "dialog-t" }, title), h("p", null, text), h("div", { class: "row" }, h("button", { class: "btn btn--s", type: "button", onclick: () => dialog.replaceChildren() }, "OK"))));
        dialog.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      function sync() { // agent refresh cycle
        if (!S.agent) return;
        S.sync = "syncing…"; draw();
        setTimeout(() => { for (const d of S.deps) d.synced = true; S.sync = new Date().toLocaleTimeString("en-GB"); refresh(); }, 1400);
      }

      // ---------- console
      const cBody = h("div", { class: "win-b" });
      const nav = h("select", { "aria-label": "Console menu", onchange: (e) => { S.view = e.target.value; drawConsole(); } },
        [["home", "Home"], ["agent", "Agent › Computers"], ["groups", "Application Control › Application Groups"], ["deploy", "Application Control › Deploy Policy"], ["systems", "Systems"]].map(([v, t]) => h("option", { value: v }, t)));
      const consoleEl = h("div", { class: "win" }, h("div", { class: "win-t" }, "endpointcentral.manageengine.com", h("small", null, "Endpoint Central Cloud")), h("div", { style: "padding:.6rem .7rem 0" }, field("Menu", nav)), cBody);
      let form = {};
      function drawConsole() {
        nav.value = S.view; nav.disabled = !S.account;
        if (!S.account) {
          form.su ??= { name: "", email: "" };
          cBody.replaceChildren(h("p", { class: "panel-k" }, "Endpoint Central Cloud — 30-day free trial, unlimited endpoints"),
            field("Name", h("input", { type: "text", value: form.su.name, oninput: (e) => (form.su.name = e.target.value) })),
            field("Business email", h("input", { type: "email", value: form.su.email, oninput: (e) => (form.su.email = e.target.value) })),
            h("button", { class: "btn btn--s", type: "button", onclick: () => {
              if (!form.su.name.trim() || !/^\S+@\S+\.\S+$/.test(form.su.email)) return api.toast("Fill in a name and a valid email.");
              cBody.replaceChildren(h("p", null, `We sent a verification link to ${form.su.email}.`), h("button", { class: "btn btn--s", type: "button", onclick: () => { S.account = true; S.view = "agent"; refresh(); } }, "Open the email and click the verification link"));
            } }, "Free Sign Up"));
          return;
        }
        if (S.view === "home") cBody.replaceChildren(h("p", null, "Welcome. Use the menu: Agent › Computers to add your PC, then Application Control."));
        if (S.view === "agent") cBody.replaceChildren(
          h("div", { class: "row" }, h("button", { class: "btn btn--s", type: "button", onclick: () => { S.agentDl = true; api.toast("LocalOffice_Agent.exe downloaded to Dell-5320 › Downloads"); refresh(); } }, "Download Agent › Windows")),
          h("div", { class: "list" }, S.agent ? h("div", null, h("b", null, "Dell-5320"), "  ", h("span", { class: "pill pill--ok" }, "Live"), h("br"), h("small", null, "Windows 11 Pro · agent 11.4 · last contact " + S.sync)) : h("div", null, "No computers yet. Download the agent and run it on the computer.")));
        if (S.view === "groups") drawGroups();
        if (S.view === "deploy") drawDeploy();
        if (S.view === "systems") cBody.replaceChildren(h("div", { class: "list" }, S.agent ? h("div", null, h("b", null, "Dell-5320"), h("br"), "Compliance Status: ",
          h("span", { class: "pill " + (S.deps.length && S.deps.every((d) => d.synced) ? "pill--ok" : "pill--warn") }, !S.deps.length ? "No policy" : S.deps.every((d) => d.synced) ? "Policy Up to Date" : "Yet to apply")) : h("div", null, "No managed computers.")),
          h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { if (S.deps.length && S.deps.every((d) => d.synced)) flag.compliance = true; drawConsole(); api.refresh(); } }, "Refresh status"));
      }
      function drawGroups() {
        const g = (form.g ??= { name: "", os: "Windows", type: "File Hash", value: "", app: "", open: false });
        if (!g.open) {
          cBody.replaceChildren(h("div", { class: "row" }, h("button", { class: "btn btn--s", type: "button", onclick: () => { g.open = true; drawGroups(); } }, "Create Blocklist")),
            h("div", { class: "list" }, S.groups.length ? S.groups.map((x) => h("div", null, h("span", { class: "pill pill--bad" }, "Blocklist"), " ", h("b", null, x.name), h("br"), h("small", null, `${x.os} · ${x.type}: ${x.app ? x.app + " — " : ""}${x.value}`))) : h("div", null, "No application groups.")));
          return;
        }
        const val = h("input", { type: "text", value: g.value, placeholder: { "File Hash": "SHA256 hash", "Product Name": "e.g. notepad.exe", "Folder Path": "e.g. C:\\Users\\Public\\*", "Trusted Vendors": "e.g. Microsoft" }[g.type], oninput: (e) => (g.value = e.target.value) });
        cBody.replaceChildren(h("p", { class: "panel-k" }, "Create Blocklist"),
          field("Target OS", h("select", { onchange: (e) => (g.os = e.target.value) }, ["Windows", "Mac", "Linux"].map((o) => h("option", { selected: o === g.os }, o)))),
          field("Blocklist name", h("input", { type: "text", value: g.name, placeholder: "Test Blacklist", oninput: (e) => (g.name = e.target.value) })),
          field("Select applications using filters", h("select", { onchange: (e) => { g.type = e.target.value; drawGroups(); } }, ["Product Name", "Trusted Vendors", "File Hash", "Folder Path"].map((o) => h("option", { selected: o === g.type }, o)))),
          g.type === "File Hash" && field("Executable name", h("input", { type: "text", value: g.app, placeholder: "Testapp.exe", oninput: (e) => (g.app = e.target.value) })),
          field(g.type, val),
          h("div", { class: "row" }, h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { g.open = false; drawGroups(); } }, "Cancel"),
            h("button", { class: "btn btn--s", type: "button", onclick: () => {
              if (!g.name.trim() || !g.value.trim()) return api.toast("Name and filter value are required.");
              if (g.type === "File Hash" && !/^[0-9a-f]{64}$/i.test(g.value.replace(/\s/g, ""))) return api.toast("A SHA256 hash is 64 hexadecimal characters.");
              S.groups.push({ name: g.name.trim(), os: g.os, type: g.type, value: g.value.trim(), app: g.app.trim() });
              form.g = null; refresh();
            } }, "Create")));
      }
      function drawDeploy() {
        const d = (form.d ??= { cg: "", apps: [], mode: "Audit", newGroup: null });
        if (d.newGroup) {
          const n = d.newGroup;
          cBody.replaceChildren(h("p", { class: "panel-k" }, "New Custom Group"),
            field("Group name", h("input", { type: "text", value: n.name, placeholder: "Lab PCs", oninput: (e) => (n.name = e.target.value) })),
            h("p", { class: "panel-k" }, "Category"), radios("cat", [["Static", "Static"], ["Dynamic", "Dynamic", "Membership by criteria"]], n.cat, (v) => (n.cat = v)),
            h("p", { class: "panel-k" }, "Membership"), radios("mem", [["Assign Manually", "Assign Manually"], ["Upload CSV", "Upload CSV"]], n.mem, (v) => (n.mem = v)),
            h("p", { class: "panel-k" }, "Available computers"),
            h("div", { class: "choice" }, S.agent ? h("label", null, h("input", { type: "checkbox", checked: n.pcs.includes("Dell-5320"), onchange: (e) => { n.pcs = e.target.checked ? ["Dell-5320"] : []; } }), h("span", null, "Dell-5320")) : h("p", null, "No computers: install the agent first.")),
            h("div", { class: "row" }, h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { d.newGroup = null; drawDeploy(); } }, "Cancel"),
              h("button", { class: "btn btn--s", type: "button", onclick: () => {
                if (!n.name.trim() || !n.pcs.length) return api.toast("Give the group a name and add a computer.");
                S.custom.push({ name: n.name.trim(), cat: n.cat, mem: n.mem, members: [...n.pcs] }); d.cg = n.name.trim(); d.newGroup = null; refresh();
              } }, "Create Group")));
          return;
        }
        cBody.replaceChildren(h("p", { class: "panel-k" }, "Associate Group"),
          h("div", { class: "row" }, field("Custom Group to be associated", h("select", { onchange: (e) => (d.cg = e.target.value) }, h("option", { value: "" }, "Choose…"), S.custom.map((c) => h("option", { selected: c.name === d.cg }, c.name)))),
            h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { d.newGroup = { name: "", cat: "Dynamic", mem: "Upload CSV", pcs: [] }; drawDeploy(); } }, "New Custom Group")),
          h("p", { class: "panel-k" }, "Application Group(s) Associated"),
          h("div", { class: "choice" }, S.groups.length ? S.groups.map((g) => h("label", null, h("input", { type: "checkbox", checked: d.apps.includes(g.name), onchange: (e) => { d.apps = e.target.checked ? [...d.apps, g.name] : d.apps.filter((x) => x !== g.name); } }), h("span", null, g.name, h("small", null, `${g.type}: ${g.value.slice(0, 24)}${g.value.length > 24 ? "…" : ""}`)))) : h("p", null, "Create a blocklist first.")),
          h("p", { class: "panel-k" }, "Enforcement Mode"),
          radios("mode", [["Audit", "Audit Mode", "Blocked apps still run; attempts are logged"], ["Strict", "Strict Mode", "Blocked apps will not run"]], d.mode, (v) => (d.mode = v)),
          h("button", { class: "btn btn--s", type: "button", onclick: () => {
            if (!d.cg || !d.apps.length) return api.toast("Choose a custom group and at least one application group.");
            S.deps = S.deps.filter((x) => x.group !== d.cg);
            S.deps.push({ group: d.cg, apps: [...d.apps], mode: d.mode, synced: false, status: "Deployed Successfully" });
            api.toast(`Deployed (${d.mode}). The agent picks it up at its next refresh.`); sync(); refresh();
          } }, "Deploy"),
          h("p", { class: "panel-k" }, "Deployments"),
          h("div", { class: "list" }, S.deps.length ? S.deps.map((x, k) => h("div", { style: "display:flex;justify-content:space-between;gap:.5rem;align-items:center" },
            h("span", null, h("b", null, x.group), ` · ${x.mode} · ${x.apps.join(", ")}`, h("br"), h("span", { class: "pill pill--ok" }, x.status), " ", h("small", null, x.synced ? "applied on agent" : "waiting for agent")),
            h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { S.deps.splice(k, 1); flag.removed = true; api.toast("Policy deleted. It syncs on the next refresh cycle."); sync(); refresh(); } }, "Delete"))) : h("div", null, "Nothing deployed.")),
        );
        flag.statusSeen ||= S.deps.some((x) => x.status === "Deployed Successfully" && x.synced);
      }

      // ---------- endpoint
      const eBody = h("div", { class: "win-b" });
      const ps = Kit.shell({
        prompt: () => "PS C:\\Windows\\system32> ", theme: "ps", ci: false, label: "PowerShell (Administrator)", after: () => refresh(),
        banner: "Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.",
        alias: (k) => k.toLowerCase(),
        notFound: (c) => `${c} : The term '${c}' is not recognized as the name of a cmdlet, function, script file, or operable program.`,
        commands: {
          "get-filehash": (a, t) => {
            const p = a.slice(1).filter((x) => !/^-/.test(x))[0];
            if (!p) return t.print("cmdlet Get-FileHash at command pipeline position 1\nSupply values for the following parameters:\nPath[0]: (type the path in the command)");
            const name = p.split("\\").pop();
            const f = FILES[name] && (FILES[name].folder + "\\" + name).toLowerCase() === p.toLowerCase() ? FILES[name] : null;
            if (!f) return t.print(`Get-FileHash : Cannot find path '${p}' because it does not exist.`, "tl-err");
            t.lines(`\nAlgorithm       Hash                                                                   Path\n---------       ----                                                                   ----\nSHA256          ${f.hash}       ${p}\n`);
            if (name === "Testapp.exe") flag.hashed = true;
          },
          cls: (a, t) => (t.out.textContent = ""), clear: (a, t) => (t.out.textContent = ""),
          whoami: (a, t) => t.print("dell-5320\\deel"),
        },
      });
      const copyBtn = h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(HASH); api.toast("Hash copied"); } catch { api.toast("Select the hash in the output and copy it"); } } }, "Copy hash");
      function runApp(app) {
        if (!S.agent) return popup(app, "The program opened normally.");
        const v = verdict(app);
        S.runs.push({ app, ...v });
        if (v.block) { popup("This app cannot be run on your machine", "Your administrator has blocked this application (Endpoint Central Application Control).", true); if (app === "Testapp.exe") flag.blocked = true; }
        else {
          if (v.audit) { S.audit.push(app); flag.audited = true; }
          popup(app, v.audit ? "The program opened. (Audit mode: the attempt was logged in the console.)" : "The program opened normally.");
          if (app === "Testapp.exe" && flag.blocked && flag.removed) flag.cleanRun = true;
        }
        refresh();
      }
      function drawEndpoint() {
        eBody.replaceChildren(
          h("p", { class: "panel-k" }, `Desktop · agent: ${S.agent ? "installed · last sync " + S.sync : "not installed"}`),
          h("div", { class: "list" },
            h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:.5rem" }, h("span", null, "▣ Testapp.exe ", h("small", null, "OneDrive › Desktop")), h("button", { class: "btn btn--s", type: "button", onclick: () => runApp("Testapp.exe") }, "Run")),
            h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:.5rem" }, h("span", null, "📝 Notepad ", h("small", null, "notepad.exe")), h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => runApp("notepad.exe") }, "Run")),
            S.agentDl && h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:.5rem" }, h("span", null, "⬇ LocalOffice_Agent.exe ", h("small", null, "Downloads")),
              S.agent ? h("span", { class: "pill pill--ok" }, "Installed") : h("button", { class: "btn btn--s", type: "button", onclick: () => installAgent() }, "Run as administrator"))),
          h("div", { class: "row" }, h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => sync() }, "Agent: refresh now"), copyBtn),
          h("p", { class: "panel-k" }, "Windows PowerShell (Administrator)"), ps.el);
      }
      async function installAgent() {
        popup("Endpoint Central Agent Setup", "Installing the agent… No reboot is required.");
        await Lab.sleep(1200);
        S.agent = true; S.sync = new Date().toLocaleTimeString("en-GB");
        popup("Endpoint Central Agent Setup", "Installation complete. Dell-5320 now reports to your console.");
        refresh();
      }
      function draw() {
        drawConsole(); if (!eBody.contains(document.activeElement)) drawEndpoint();
        topo.update(() => (S.agent ? "up" : "off"));
        note.textContent = `Agent: ${S.agent ? "installed" : "not installed"} · blocklists: ${S.groups.length} · deployments: ${S.deps.map((d) => `${d.mode}${d.synced ? "" : " (pending)"}`).join(", ") || "none"}`;
      }
      api.termOf = () => ps;
      api.stage.append(api.dock());
      api.device("console", "Endpoint Central", "Web console", consoleEl);
      api.device("endpoint", "Dell-5320", "Windows 11 endpoint", h("div", { class: "win" }, h("div", { class: "win-t" }, "Dell-5320", h("small", null, "user DEEL")), eBody));
      draw();
    },
    tasks: [
      { title: "Sign up for Endpoint Central Cloud", detail: "Cloud (SaaS) needs no server install. Verify your email to log in.", where: "Endpoint Central", check: () => S.account },
      { title: "Download the agent and install it on Dell-5320", detail: "Console: Agent › Computers › Download Agent. Then run the installer as Administrator on the computer.", where: "Console + Dell-5320", check: () => S.agent },
      { title: "Get the file hash of Testapp.exe", where: "Dell-5320 › PowerShell (Administrator)", answer: `Get-FileHash "${PATH}"`, device: "endpoint", type: `Get-FileHash "${PATH}"`, check: () => flag.hashed },
      { title: "Create the blocklist “Test Blacklist” using the File Hash filter", detail: "Application Control › Application Groups › Create Blocklist. Paste the exact hash.", where: "Endpoint Central",
        hint: "Target OS Windows, filter File Hash, executable name Testapp.exe, then paste the 64-character SHA256 value.", check: () => S.groups.some((g) => g.type === "File Hash" && g.value.replace(/\s/g, "").toUpperCase() === HASH) },
      { title: "Create a Static custom group containing Dell-5320", detail: "Deploy Policy › New Custom Group: category <b>Static</b>, membership <b>Assign Manually</b>.", where: "Endpoint Central",
        check: () => S.custom.some((c) => c.cat === "Static" && c.mem === "Assign Manually" && c.members.includes("Dell-5320")) },
      { title: "Deploy the blocklist in <b>Strict</b> mode", detail: "Associate the custom group with the application group, choose Strict, Deploy.", where: "Endpoint Central › Deploy Policy",
        hint: "Audit mode would only log. Strict actually blocks.", check: () => S.deps.some((d) => d.mode === "Strict" && d.apps.some((a) => S.groups.find((g) => g.name === a)?.value.replace(/\s/g, "").toUpperCase() === HASH)) },
      { title: "Check compliance and deployment status", detail: "Systems › Dell-5320 should show <b>Policy Up to Date</b>; the deployment shows <b>Deployed Successfully</b>.", where: "Endpoint Central › Systems / Deploy Policy",
        hint: "After the agent refresh, open Systems and press Refresh status.", check: () => flag.compliance },
      { title: "Run Testapp.exe on Dell-5320: it must be blocked", where: "Dell-5320", check: () => flag.blocked },
      { title: "Clean up: delete the deployment, then run the app again", detail: "The change syncs on the next refresh cycle.", where: "Console › Deploy Policy, then Dell-5320", check: () => flag.cleanRun },
    ],
    doneText: "You blocked Testapp.exe on Dell-5320 from the cloud console, with nothing configured locally. That is the “remote commander” model, in contrast to AppLocker's local guard.",
    quiz: [
      { t: "mcq", q: "What does this lab demonstrate about Endpoint Central's Application Control?", opts: ["Centralized management: the block is issued from the web console, not from the Windows computer", "That AppLocker is required on every endpoint", "That blacklisting is stronger than whitelisting", "That web applications can be blocked by hash"], a: 0, src: "Advanced Lab 2, What this lab proves" },
      { t: "match", q: "Match the term to how the lab demonstrates it.", pairs: [["Centralized management", "Block instruction issued from the web console"], ["Precise blocking", "A driver intercepts the launch and it fails"], ["Applicable scope", "A local .exe/.msi desktop app, not a web app"], ["Remote commander vs local guard", "One console vs AppLocker configured per machine"]], src: "Advanced Lab 2, What this lab proves" },
      { t: "cmd", q: "Which PowerShell cmdlet gives the hash used in the blocklist?", a: ["Get-FileHash", `Get-FileHash "${PATH}"`, /^get-filehash\b/i], src: "Advanced Lab 2, Phase 3 step 4" },
      { t: "multi", q: "Which filters can select applications for a blocklist? (Choose all that apply)", opts: ["Product Name", "Trusted Vendors", "File Hash", "Folder Path", "Wi-Fi SSID"], a: [0, 1, 2, 3], src: "Advanced Lab 2, Phase 3 step 4" },
      { t: "mcq", q: "What is the difference between Audit and Strict mode?", opts: ["Audit: blocked apps still run but attempts are logged; Strict: blocked apps will not run", "Audit blocks; Strict only logs", "Both block, but Strict also deletes the file", "Audit applies to Mac; Strict to Windows"], a: 0, src: "Advanced Lab 2, Phase 4 step 4" },
      { t: "tf", q: "The blocklist takes effect as soon as you create it in Application Groups.", a: false, why: "The blocklist is not active until you deploy it (Deploy Policy).", src: "Advanced Lab 2, Phase 4" },
      { t: "order", q: "Order the phases.", items: ["Get the free trial (Cloud)", "Install the agent on the test computer", "Create the blocklist", "Deploy the policy to a custom group", "Verify the result", "Clean up"], src: "Advanced Lab 2, Phases 1–6" },
      { t: "fill", q: "When Testapp.exe is blocked, the user sees: “This app cannot be ___ on your machine.”", a: ["run"], src: "Advanced Lab 2, Phase 5" },
      { t: "mcq", q: "When is AppLocker (or local Group Policy) the simplest choice instead of Endpoint Central?", opts: ["When you only want to block a program on your own single computer", "When managing hundreds of computers with reporting", "When you need to block by trusted vendor across an enterprise", "When you need privilege management"], a: 0, src: "Advanced Lab 2, “In simple terms”" },
      { t: "short", q: "Why is blocking by <b>file hash</b> more precise than blocking by folder path? What is its weakness?", model: "A hash identifies the exact file contents, so moving or renaming the file doesn't bypass it (unlike a path rule). Its weakness: any change to the file (a new version, one byte different) produces a new hash, so the rule no longer matches.",
        keys: [["exact", "contents", "identifies the file"], ["move", "rename", "location"], ["change", "new version", "modified", "different hash"]], src: "Advanced Lab 2, Phase 3; compare Advanced Lab 1 (path-rule bypass)" },
      { t: "mcq", q: "How do you stop the experiment?", opts: ["Delete the deployment policy or remove the computer from the custom group", "Uninstall Windows Defender", "Rename the file", "Reboot the endpoint twice"], a: 0, src: "Advanced Lab 2, Phase 6" },
      { t: "tf", q: "Blacklisting blocks only known-bad applications, so a brand-new malicious file can still run.", a: true, why: "That is why the AppLocker lab calls whitelisting stronger.", src: "Advanced Lab 1, Section 2" },
      { t: "mcq", q: "What extra capability does Endpoint Central offer that AppLocker lacks, per the comparison table?", opts: ["Endpoint Privilege Management (standard users can run specific programs with admin rights)", "Publisher rules", "Event logging", "Path rules"], a: 0, src: "Advanced Lab 2, comparison table" },
    ],
  });
})();
