// Advanced Cybersecurity · Experiment 1 — Application Whitelisting Using AppLocker (Windows 11 Pro).
(() => {
  const { h } = Lab;
  const { field, radios, win } = Kit;
  const DL = "C:\\Users\\DEEL\\Downloads", DT = "C:\\Users\\DEEL\\Desktop";
  const DEFAULTS = [
    { action: "Allow", user: "Everyone", cond: "Path", path: "%PROGRAMFILES%\\*", name: "(Default Rule) All files located in the Program Files folder", def: true },
    { action: "Allow", user: "Everyone", cond: "Path", path: "%WINDIR%\\*", name: "(Default Rule) All files located in the Windows folder", def: true },
    { action: "Allow", user: "BUILTIN\\Administrators", cond: "Path", path: "*", name: "(Default Rule) All files", def: true },
  ];
  const S = { svc: "Stopped", file: null, enforce: "Not configured", rules: [], applied: null, events: [], last: null };
  const flag = {};
  const expand = (p) => p.replace(/^%OSDRIVE%/i, "C:").replace(/^%WINDIR%/i, "C:\\Windows").replace(/^%PROGRAMFILES%/i, "C:\\Program Files");
  const pathMatch = (rule, file) => {
    if (rule === "*") return true;
    const r = expand(rule).toLowerCase(), f = file.toLowerCase();
    return r.endsWith("\\*") ? f.startsWith(r.slice(0, -1)) : f === r;
  };
  const osd = (p) => p.replace(/^C:/i, "%OSDRIVE%").toUpperCase();

  // what AppLocker decides for the file at its current location
  function decide() {
    const file = (S.file === "Desktop" ? DT : DL) + "\\test-app.exe";
    const P = S.applied;
    if (!P || S.svc !== "Running" || (!P.rules.length && P.enforce === "Not configured")) return { run: true, file, id: null, why: !P ? "No AppLocker policy applied yet (run gpupdate /force)." : S.svc !== "Running" ? "The Application Identity service is stopped, so AppLocker doesn't evaluate anything." : "No rules." };
    const deny = P.rules.find((r) => r.action === "Deny" && pathMatch(r.path, file));
    const allow = P.rules.find((r) => r.action === "Allow" && (r.user === "Everyone" || r.user === "BUILTIN\\Administrators") && pathMatch(r.path, file));
    const audit = P.enforce === "Audit only";
    if (!deny && allow) return { run: true, file, id: 8002, level: "Information", msg: `${osd(file)} was allowed to run.`, rule: allow.name };
    // denied explicitly, or implicitly (no allow rule matches)
    if (audit) return { run: true, file, id: 8003, level: "Warning", msg: `${osd(file)} was allowed to run but would have been prevented from running if the AppLocker policy were enforced.`, rule: deny?.name || "(implicit deny)" };
    return { run: false, file, id: 8004, level: "Error", msg: `${osd(file)} was prevented from running.`, rule: deny?.name || "(implicit deny)" };
  }

  Lab.start({
    brief: `
<p>Implement <b>application whitelisting</b> on Windows 11 Pro with <b>AppLocker</b>: block executables in the Downloads folder, test the policy in <b>Audit only</b> mode, enforce it, check the evidence in <b>Event Viewer</b>, then show why <b>path rules</b> can be bypassed.</p>
<p class="key"><b>Whitelisting</b> allows only explicitly approved applications; everything else is blocked by default. That is stronger than <b>blacklisting</b> (blocking known-bad files) because unknown or new malware is blocked too.</p>
<h3>Requirements</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Requirement</th><th>Details</th></tr>
<tr><td>Operating system</td><td>Windows 10/11 Pro, Enterprise or Education</td></tr>
<tr><td>Administrator access</td><td>Signed in as an administrator (user DEEL)</td></tr>
<tr><td>Application Identity service</td><td>Must be running (AppIDSvc)</td></tr>
<tr><td>Local Security Policy</td><td>secpol.msc</td></tr>
<tr><td>Test file</td><td>test-app.exe in Downloads</td></tr></table></div>
<h3>Event IDs</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>Meaning</th><th>Handout</th><th>Windows (EXE and DLL log)</th></tr>
<tr><td>Would have been blocked (Audit only)</td><td>8004</td><td>8003</td></tr>
<tr><td>Was blocked (Enforce rules)</td><td>8005</td><td>8004</td></tr>
<tr><td>Was allowed</td><td>—</td><td>8002</td></tr></table></div>
<p class="note">This simulator shows the IDs Windows really logs. The handout's numbers are one higher. In an exam about this lab, answer as your instructor taught (the handout), and know the meaning: <b>audit = would have been blocked</b>, <b>enforce = was blocked</b>.</p>
<p>Open the tools from the tabs under the diagram: <b>Services</b>, <b>File Explorer</b>, <b>Local Security Policy</b>, <b>Command Prompt</b> (Administrator) and <b>Event Viewer</b>.</p>`,
    setup(api) {
      const topo = new api.Topo({ w: 300, h: 110, label: "One Windows 11 Pro PC", nodes: [{ id: "pc", kind: "laptop", label: "DEEL-PC", sub: "Windows 11 Pro · local admin DEEL", x: 150, y: 45 }], links: [] });
      const note = h("p", { class: "topo-note" });
      const dialog = h("div");
      api.stage.append(h("div", null, topo.el, note), dialog);
      function popup(title, text, bad, buttons) {
        dialog.replaceChildren(h("div", { class: "dialog" + (bad ? " dialog--bad" : "") }, h("p", { class: "dialog-t" }, title), h("p", null, text),
          h("div", { class: "row" }, (buttons || [["OK", () => dialog.replaceChildren()]]).map(([t, fn]) => h("button", { class: "btn btn--s", type: "button", onclick: fn }, t)))));
        dialog.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      const refresh = () => { draw(); api.refresh(); };

      // ---------- Services
      const svcBody = h("div", { class: "list" });
      const services = h("div", null, win("Services (Local)", "services.msc", svcBody));
      // ---------- File Explorer
      const feBody = h("div", { class: "win-b" });
      const explorer = win("File Explorer", "This PC › Local Disk (C:) › Users › DEEL", feBody);
      // ---------- secpol
      const spTree = h("div", { class: "tree" });
      const spBody = h("div", { class: "win-b" });
      let spNode = "root", wiz = null;
      const secpol = h("div", { class: "win" }, h("div", { class: "win-t" }, "Local Security Policy", h("small", null, "secpol.msc")), spTree, spBody);
      // ---------- Event viewer
      const evTree = h("div", { class: "tree" });
      const evBody = h("div", { class: "win-b" });
      let evPath = 0;
      const EVP = ["Event Viewer (Local)", "Applications and Services Logs", "Microsoft", "Windows", "AppLocker", "EXE and DLL"];
      const evwin = h("div", { class: "win" }, h("div", { class: "win-t" }, "Event Viewer", h("small", null, "eventvwr.msc")), evTree, evBody);

      // ---------- Command prompt (Administrator)
      const cmd = Kit.shell({
        prompt: () => "C:\\Windows\\system32>", theme: "cmd", ci: true, label: "Administrator command prompt", after: refresh,
        banner: "Administrator: Command Prompt\nMicrosoft Windows [Version 10.0.22631.4317]",
        notFound: (c) => `'${c}' is not recognized as an internal or external command,\noperable program or batch file.`,
        alias: (k, a) => (/test-app\.exe$/i.test(a[0]) ? "__run" : null),
        commands: {
          gpupdate: async (a, t) => {
            if (!a.some((x) => /^\/force$/i.test(x))) t.print("(tip: /force reapplies every policy setting)", "tl-dim");
            t.print("Updating policy..."); if (!(await t.wait(1200))) return;
            t.print(""); t.print("Computer Policy update has completed successfully."); t.print("User Policy update has completed successfully."); t.print("");
            S.applied = JSON.parse(JSON.stringify({ enforce: S.enforce, rules: S.rules }));
            flag.gp = (flag.gp || 0) + 1;
            if (S.applied.enforce === "Enforce rules") flag.gpEnforce = true; else if (S.applied.enforce === "Audit only") flag.gpAudit = true;
            if (S.applied.enforce !== "Audit only" && S.applied.rules.length && !S.applied.rules.some((r) => r.def)) popup("Warning: no default rules", "Every program not covered by an Allow rule is now blocked, including Windows tools. On a real PC you could lock yourself out. Create the default rules first.", true);
          },
          sc: (a, t) => {
            const op = (a[1] || "").toLowerCase(), svc = (a[2] || "").toLowerCase();
            if (svc !== "appidsvc") return t.print("[SC] OpenService FAILED 1060:\n\nThe specified service does not exist as an installed service.");
            if (op === "query") return t.lines(`\nSERVICE_NAME: AppIDSvc\n        TYPE               : 20  WIN32_SHARE_PROCESS\n        STATE              : ${S.svc === "Running" ? "4  RUNNING" : "1  STOPPED"}\n`);
            if (op === "start") { if (S.svc === "Running") return t.print("[SC] StartService FAILED 1056:\n\nAn instance of the service is already running."); S.svc = "Running"; return t.lines(`\nSERVICE_NAME: AppIDSvc\n        STATE              : 2  START_PENDING`); }
            t.print("DESCRIPTION:\n        SC is a command line program used for communicating with the Service Control Manager.");
          },
          net: (a, t) => {
            if ((a[1] || "").toLowerCase() === "start" && /appidsvc|application identity/i.test(a.slice(2).join(" "))) {
              if (S.svc === "Running") return t.print("The requested service has already been started.");
              S.svc = "Running"; t.print("The Application Identity service is starting."); t.print("The Application Identity service was started successfully.");
            } else t.print("The syntax of this command is:\n\nNET START [service]");
          },
          __run: (a, t) => {
            const loc = /\\desktop\\/i.test(a[0]) ? "Desktop" : /\\downloads\\/i.test(a[0]) ? "Downloads" : null;
            if (!S.file || loc !== S.file) return t.print("The system cannot find the path specified.");
            run(t);
          },
          cls: (a, t) => (t.out.textContent = ""),
        },
      });

      function run(t) {
        const d = decide();
        if (d.id) S.events.unshift({ ...d, time: new Date().toLocaleTimeString("en-GB") });
        S.last = d;
        if (d.run) {
          t ? t.print("") : popup("test-app.exe", "The test program started and ran normally.", false);
          if (S.applied?.enforce === "Audit only" && d.id === 8003 && S.file === "Downloads") flag.ranAudit = true;
          if (S.applied?.enforce === "Enforce rules" && S.file === "Desktop") flag.bypass = true;
        } else {
          t ? t.print("This program is blocked by group policy. For more information, contact your system administrator.") : popup("This app has been blocked by your system administrator.", "Contact your system administrator for more info.", true);
          if (S.file === "Downloads") flag.blocked = true;
        }
        refresh();
      }

      function drawSvc() {
        svcBody.replaceChildren(
          h("div", { style: "display:grid;grid-template-columns:1fr auto;gap:.2rem .6rem;font-family:var(--font-pixel);font-size:.72rem;color:var(--c-ink-muted)" }, h("span", null, "Name · Startup type"), h("span", null, "Status")),
          ...[["Application Identity", "Manual (Trigger Start)", S.svc, true], ["Application Information", "Manual (Trigger Start)", "Running"], ["Windows Defender Firewall", "Automatic", "Running"], ["Windows Update", "Manual (Trigger Start)", "Running"]].map(([n, st, status, ours]) =>
            h("div", { class: ours ? "sel" : "" }, h("div", { style: "display:flex;justify-content:space-between;gap:.5rem;align-items:center" },
              h("span", null, h("b", null, n), h("br"), h("small", null, st)),
              h("span", { class: "row" }, h("span", { class: "pill " + (status === "Running" ? "pill--ok" : "") }, status === "Running" ? "Running" : "Stopped"),
                ours && status !== "Running" && h("button", { class: "btn btn--s", type: "button", onclick: () => { S.svc = "Running"; refresh(); } }, "Start"),
                ours && status === "Running" && h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { S.svc = "Stopped"; refresh(); } }, "Stop"))))),
        );
      }
      function drawFE() {
        const row = (loc) => h("div", { class: "list" },
          h("div", { class: "sel" }, h("b", null, loc === "Downloads" ? "📁 Downloads" : "📁 Desktop"), h("small", null, `  ${loc === "Downloads" ? DL : DT}`)),
          S.file === loc ? h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap" }, h("span", null, "▣ test-app.exe ", h("small", null, "Application · 1,024 KB")),
            h("span", { class: "row" }, h("button", { class: "btn btn--s", type: "button", onclick: () => run() }, "Run"),
              h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { S.file = loc === "Downloads" ? "Desktop" : "Downloads"; refresh(); } }, `Move to ${loc === "Downloads" ? "Desktop" : "Downloads"}`)))
            : h("div", null, h("small", null, "(empty)")));
        feBody.replaceChildren(row("Downloads"), row("Desktop"),
          !S.file && h("button", { class: "btn btn--s", type: "button", onclick: () => { S.file = "Downloads"; refresh(); } }, "Create test-app.exe in Downloads"));
      }
      function drawSecpol() {
        const nodes = [["root", "Security Settings"], ["acp", "  Application Control Policies"], ["al", "    AppLocker"], ["exe", "      Executable Rules"]];
        spTree.replaceChildren(...nodes.map(([k, t]) => h("button", { type: "button", "aria-current": spNode === k, onclick: () => { spNode = k; wiz = null; drawSecpol(); } }, t)));
        if (spNode === "root" || spNode === "acp") { spBody.replaceChildren(h("p", null, "Expand down to Application Control Policies › AppLocker.")); return; }
        if (spNode === "al") {
          let pick = S.enforce;
          spBody.replaceChildren(h("p", { class: "panel-k" }, "AppLocker › Configure Rule Enforcement › Executable rules"),
            radios("enf", [["Not configured", "Not configured", "Rules are enforced if any exist"], ["Enforce rules", "Enforce rules", "Blocks files the rules deny"], ["Audit only", "Audit only", "Only logs what would be blocked"]], S.enforce, (v) => (pick = v)),
            h("div", { class: "row" }, h("button", { class: "btn btn--s", type: "button", onclick: () => { S.enforce = pick; api.toast("Enforcement: " + pick + " (run gpupdate /force to apply)"); refresh(); } }, "OK")));
          return;
        }
        if (wiz) return drawWizard();
        spBody.replaceChildren(
          h("div", { class: "row" },
            h("button", { class: "btn btn--s", type: "button", onclick: () => { for (const r of DEFAULTS) if (!S.rules.some((x) => x.name === r.name)) S.rules.push({ ...r }); refresh(); } }, "Create Default Rules"),
            h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => {
              if (!S.rules.some((r) => r.def)) return popup("AppLocker", "One or more of the default rules have not been created. Do you want to create the default rules now?", false,
                [["Yes", () => { for (const r of DEFAULTS) if (!S.rules.some((x) => x.name === r.name)) S.rules.push({ ...r }); dialog.replaceChildren(); wiz = { step: 0, action: "Allow", user: "Everyone", cond: "Path", path: "%OSDRIVE%\\Users\\DEEL\\Downloads\\*" }; refresh(); }],
                 ["No", () => { dialog.replaceChildren(); wiz = { step: 0, action: "Allow", user: "Everyone", cond: "Path", path: "%OSDRIVE%\\Users\\DEEL\\Downloads\\*" }; refresh(); }]]);
              wiz = { step: 0, action: "Allow", user: "Everyone", cond: "Path", path: "%OSDRIVE%\\Users\\DEEL\\Downloads\\*" }; drawSecpol();
            } }, "Create New Rule…")),
          h("div", { class: "list" }, S.rules.length ? S.rules.map((r, k) => h("div", { style: "display:flex;gap:.5rem;justify-content:space-between;align-items:center" },
            h("span", null, h("span", { class: "pill " + (r.action === "Deny" ? "pill--bad" : "pill--ok") }, r.action), " ", h("b", null, r.name), h("br"), h("small", null, `${r.user} · ${r.cond}: ${r.path}`)),
            h("button", { class: "btn btn--ghost btn--s", type: "button", "aria-label": "Delete rule", onclick: () => { S.rules.splice(k, 1); refresh(); } }, "✕"))) : h("div", null, "There are no items to show in this view.")));
      }
      function drawWizard() {
        const w = wiz;
        const steps = ["Permissions", "Conditions", "Path", "Name"];
        const head = h("p", { class: "panel-k" }, `Create Executable Rules · ${steps.map((s, k) => (k === w.step ? `[${s}]` : s)).join(" › ")}`);
        let body;
        if (w.step === 0) body = [radios("act", [["Allow", "Allow"], ["Deny", "Deny"]], w.action, (v) => (w.action = v)), field("User or group", h("select", { onchange: (e) => (w.user = e.target.value) }, ["Everyone", "BUILTIN\\Administrators", "BUILTIN\\Users"].map((u) => h("option", { selected: u === w.user }, u))))];
        else if (w.step === 1) body = [radios("cond", [["Publisher", "Publisher", "Signed software — survives moving the file"], ["Path", "Path", "A file or folder location"], ["File hash", "File hash", "One exact file"]], w.cond, (v) => (w.cond = v))];
        else if (w.step === 2) body = w.cond === "Path" ? [field("Path", h("input", { type: "text", value: w.path, oninput: (e) => (w.path = e.target.value) })), h("p", { class: "ipf-note" }, "Use * as a wildcard for every file in the folder.")] : [h("p", null, `${w.cond} rules need a reference file; this lab uses a Path rule. Go Back and choose Path.`)];
        else body = [field("Name", h("input", { type: "text", value: w.name ?? w.path, oninput: (e) => (w.name = e.target.value) }))];
        const ok = !(w.step === 2 && w.cond !== "Path");
        spBody.replaceChildren(head, ...body, h("div", { class: "row" },
          h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { if (w.step) { w.step--; drawWizard(); } else { wiz = null; drawSecpol(); } } }, w.step ? "< Previous" : "Cancel"),
          w.step < 3 ? h("button", { class: "btn btn--s", type: "button", disabled: !ok, onclick: () => { w.step++; drawWizard(); } }, "Next >")
            : h("button", { class: "btn btn--s", type: "button", onclick: () => { S.rules.push({ action: w.action, user: w.user, cond: w.cond, path: w.path.trim(), name: (w.name ?? w.path).trim() }); wiz = null; refresh(); } }, "Create")));
      }
      function drawEv() {
        evTree.replaceChildren(...EVP.slice(0, evPath + 1).map((t, k) => h("button", { type: "button", style: `padding-inline-start:${0.35 + k * 0.6}rem`, "aria-current": k === evPath, onclick: () => { evPath = k; drawEv(); } }, (k < evPath ? "▾ " : "▸ ") + t)),
          evPath < EVP.length - 1 && h("button", { type: "button", style: `padding-inline-start:${0.35 + (evPath + 1) * 0.6}rem`, onclick: () => { evPath++; drawEv(); api.refresh(); } }, "▸ " + EVP[evPath + 1] + " …"));
        if (evPath < EVP.length - 1) { evBody.replaceChildren(h("p", null, "Expand the tree to Applications and Services Logs › Microsoft › Windows › AppLocker › EXE and DLL.")); return; }
        flag.evOpen = true;
        evBody.replaceChildren(h("p", { class: "panel-k" }, `EXE and DLL · Number of events: ${S.events.length}`),
          h("div", { class: "list" }, S.events.length ? S.events.map((e) => h("div", null,
            h("span", { class: "pill " + (e.level === "Error" ? "pill--bad" : e.level === "Warning" ? "pill--warn" : "pill--ok") }, e.level), " ",
            h("b", null, `Event ID ${e.id}`), h("small", null, `  ${e.time} · AppLocker`), h("br"), h("span", null, e.msg), h("br"), h("small", null, `Rule: ${e.rule}`))) : h("div", null, "No events yet.")),
          h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { flag.ev8003 ||= S.events.some((e) => e.id === 8003); flag.ev8004 ||= S.events.some((e) => e.id === 8004); drawEv(); api.refresh(); } }, "Refresh"));
        flag.ev8003 ||= S.events.some((e) => e.id === 8003);
        flag.ev8004 ||= S.events.some((e) => e.id === 8004);
      }
      function draw() {
        drawSvc(); drawFE(); drawSecpol(); drawEv();
        const P = S.applied;
        note.textContent = `AppIDSvc: ${S.svc} · configured: ${S.enforce}, ${S.rules.length} rule(s) · applied: ${P ? `${P.enforce}, ${P.rules.length} rule(s)` : "nothing yet"}${P && (P.enforce !== S.enforce || P.rules.length !== S.rules.length) ? " · run gpupdate /force to apply changes" : ""}`;
      }
      api.termOf = (id) => (id === "cmd" ? cmd : null);
      api.stage.append(api.dock());
      api.device("svc", "Services", "services.msc", services);
      api.device("fe", "File Explorer", "Downloads / Desktop", explorer);
      api.device("sp", "Security Policy", "secpol.msc", secpol);
      api.device("cmd", "Command Prompt", "Administrator", cmd.el);
      api.device("ev", "Event Viewer", "AppLocker logs", evwin);
      api.onShow = () => { draw(); };
      draw();
    },
    diagnose() {
      const d = decide();
      return d.why || (d.id ? `Last evaluation: Event ${d.id} — ${d.msg}` : "Run the file to see AppLocker's decision.");
    },
    tasks: [
      { title: "Start the Application Identity service", detail: "Without AppIDSvc, AppLocker can't evaluate rules or log events.", where: "Services (or Command Prompt)", hint: "Start it in Services, or with <code>sc start appidsvc</code>.", answer: "sc start appidsvc", device: "cmd", type: "sc start appidsvc", check: () => S.svc === "Running" },
      { title: "Create the test file test-app.exe in Downloads", where: "File Explorer", hint: "Use the Create button in File Explorer.", check: () => !!S.file },
      { title: "Create the default rules", detail: "In Local Security Policy › Application Control Policies › AppLocker › Executable Rules.", where: "Security Policy", hint: "Without them, enforcing AppLocker would block Windows itself.", check: () => S.rules.filter((r) => r.def).length === 3 },
      { title: "Set enforcement to <b>Audit only</b>", where: "Security Policy › AppLocker", hint: "Select the AppLocker node, choose Audit only and press OK.", check: () => S.enforce === "Audit only" || flag.gpAudit },
      { title: "Create a Deny path rule for the Downloads folder", detail: "Everyone · Path · <code>%OSDRIVE%\\Users\\DEEL\\Downloads\\*</code>", where: "Security Policy › Executable Rules › Create New Rule…",
        hint: "Permissions: Deny, Everyone → Conditions: Path → Path: %OSDRIVE%\\Users\\DEEL\\Downloads\\* → Create.",
        check: () => S.rules.some((r) => r.action === "Deny" && r.cond === "Path" && r.user === "Everyone" && pathMatch(r.path, DL + "\\test-app.exe") && !pathMatch(r.path, DT + "\\x.exe")) },
      { title: "Apply the policy", where: "Command Prompt", answer: "gpupdate /force", device: "cmd", type: "gpupdate /force", check: () => flag.gpAudit && S.applied.rules.some((r) => r.action === "Deny") },
      { title: "Run test-app.exe in Audit mode", detail: "It still runs, but AppLocker logs what it would have done.", where: "File Explorer › Run", check: () => flag.ranAudit },
      { title: "Find the audit event in Event Viewer", detail: "Applications and Services Logs › Microsoft › Windows › AppLocker › EXE and DLL. Windows logs ID <b>8003</b> (“would have been prevented”); the handout calls it 8004.", where: "Event Viewer", check: () => flag.evOpen && flag.ev8003 },
      { title: "Switch to <b>Enforce rules</b> and apply", where: "Security Policy › AppLocker, then Command Prompt", answer: "(AppLocker › Enforce rules › OK)\ngpupdate /force", device: "cmd", type: () => (S.enforce === "Enforce rules" ? "gpupdate /force" : ""), check: () => flag.gpEnforce && S.applied.enforce === "Enforce rules" },
      { title: "Run test-app.exe again: it must be blocked", where: "File Explorer › Run", check: () => flag.blocked },
      { title: "Find the block event", detail: "Windows logs ID <b>8004</b> (“was prevented from running”); the handout calls it 8005.", where: "Event Viewer › Refresh", check: () => flag.ev8004 },
      { title: "Test the bypass: move the file to the Desktop and run it", detail: "A path rule only covers its folder.", where: "File Explorer", check: () => flag.bypass },
    ],
    doneText: "Audit logged, Enforce blocked, and moving the file to the Desktop bypassed the path rule: exactly the results table in the handout. Publisher rules would have stopped the bypass.",
    quiz: [
      { t: "mcq", q: "What is application whitelisting?", opts: ["Only explicitly approved applications may run; everything else is blocked by default", "Known malicious files are blocked; everything else runs", "Applications are scanned by antivirus before running", "Users choose which applications to trust"], a: 0, src: "Advanced Lab 1, Section 2" },
      { t: "mcq", q: "Why is whitelisting stronger than blacklisting?", opts: ["Unknown or new malicious files are blocked automatically, even if never seen before", "It is easier to maintain", "It needs no administrator", "It uses less disk space"], a: 0, src: "Advanced Lab 1, Section 2" },
      { t: "fill", q: "AppLocker cannot evaluate rules or generate events unless the <b>__________ ________</b> service (AppIDSvc) is running.", a: ["Application Identity"], src: "Advanced Lab 1, Section 3" },
      { t: "mcq", q: "Why must the Default Rules be created before enforcing AppLocker?", opts: ["AppLocker is deny-by-default; without rules allowing Windows and Program Files, enforcement would block the OS itself", "They speed up gpupdate", "They are required to open secpol.msc", "They enable Audit mode"], a: 0, src: "Advanced Lab 1, Section 5 (Default Rules Are Critical)" },
      { t: "mcq", q: "What is the purpose of Audit only mode?", opts: ["It logs what would be blocked without blocking anything, so rules can be tested safely", "It blocks everything and logs nothing", "It deletes blocked files", "It sends alerts to the administrator by email"], a: 0, src: "Advanced Lab 1, Section 5 (Audit Mode Is a Safety Net)" },
      { t: "match", q: "Match the result to the mode, according to the handout's results table.", pairs: [["Run from Downloads, Audit only", "File ran; event logged"], ["Run from Downloads, Enforce rules", "File blocked"], ["Run from Desktop, Enforce rules", "File ran (bypass)"]], src: "Advanced Lab 1, Section 6" },
      { t: "mcq", q: "According to the <b>handout</b>, which Event ID means “would have been blocked” in Audit mode?", opts: ["8004", "8005", "8002", "4625"], a: 0, why: "The handout lists 8004 (audit) and 8005 (enforce). On Windows itself the EXE and DLL log uses 8003 for audit and 8004 for blocked, which is what the simulator shows. Know both, and answer as your instructor expects.", src: "Advanced Lab 1, Section 5; Microsoft AppLocker event reference" },
      { t: "cmd", q: "Which command applies the new policy immediately?", a: ["gpupdate /force"], src: "Advanced Lab 1, Section 4 step 7" },
      { t: "short", q: "The file ran from the Desktop even with Enforce rules on. Explain why, and how to prevent it.", model: "The Deny rule is a <b>path rule</b> that only covers the Downloads folder, so moving the file to another folder bypasses it. A <b>publisher</b> (or file-hash) rule identifies the file itself rather than its location, so it would still match after the file is moved.",
        keys: [["path rule", "path"], ["location", "folder", "moved", "moving"], ["publisher", "hash"]], src: "Advanced Lab 1, Sections 5 and 7" },
      { t: "order", q: "Order the main steps of the experiment.", items: ["Start the Application Identity service", "Create the default rules", "Set enforcement to Audit only", "Create the Deny rule for Downloads", "Run gpupdate /force", "Run test-app.exe and check Event Viewer", "Switch to Enforce rules and test again", "Test the bypass from the Desktop"], src: "Advanced Lab 1, Section 4" },
      { t: "fill", q: "Where are AppLocker events in Event Viewer? Applications and Services Logs › Microsoft › Windows › AppLocker › ___ and ___", a: ["EXE and DLL", "exe dll"], src: "Advanced Lab 1, Section 5" },
      { t: "tf", q: "With AppLocker enforced, a program that matches no Allow rule is allowed to run by default.", a: false, why: "AppLocker works on a deny-by-default principle.", src: "Advanced Lab 1, Section 5; Lecture 1 §1.8.10 (secure defaults, fail closed)" },
      { t: "mcq", q: "Which Lecture 1 design principle does AppLocker's deny-by-default behaviour reflect?", opts: ["Secure defaults and fail-safe design (fail closed)", "Shift-left testing", "Data minimization", "Separation of duties"], a: 0, src: "Advanced Lecture 1 §1.8.10" },
      { t: "short", q: "The conclusion calls whitelisting a “defense-in-depth control that limits the blast radius”. What does that mean?", model: "Whitelisting is one extra independent layer: even if an attacker gets onto the system (another layer failed), unapproved programs they bring can't run, so the damage they can do is limited.",
        keys: [["layer", "layers", "defense in depth"], ["attacker", "access", "compromise"], ["limit", "limits", "reduce", "damage"]], src: "Advanced Lab 1, Section 7; Lecture 1 (Defense in Depth)" },
    ],
  });
})();
