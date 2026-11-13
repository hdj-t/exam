// Cloud Computing · Lab 1 — Exploring Cloud Hosting Platforms (portal walkthrough, specs and pricing).
(() => {
  const { h } = Lab;
  const flag = { seen: new Set() };
  const CONSOLES = {
    aws: { name: "AWS Management Console", color: "#232F3E", accent: "#FF9900",
      top: [["region", "Region: Europe (Frankfurt) ▾"], ["search", "Search resources, services, docs…"]],
      nav: [["dash", "Dashboard"], ["compute", "EC2 — Virtual Servers"], ["storage", "S3 — Object Storage"], ["network", "VPC — Networking"], ["iam", "IAM"], ["billing", "Billing Dashboard"]],
      info: { region: "Every resource lives in a chosen geographic region (top-right).", search: "Jump directly to any of 200+ AWS services by name.", compute: "EC2: launch and manage virtual servers (IaaS).", storage: "S3: object storage buckets.", network: "VPC: your private network in AWS.", iam: "IAM: users, roles, policies.", billing: "Real-time cost tracking and Free Tier usage alerts.", dash: "Recently visited services and health." } },
    azure: { name: "Microsoft Azure Portal", color: "#0F6CBD", accent: "#50E6FF",
      top: [["directory", "Directory: University tenant ▾"], ["search", "Search resources, services, docs…"]],
      nav: [["dash", "Dashboard"], ["compute", "Virtual Machines"], ["storage", "Storage Accounts"], ["rg", "Resource Groups"], ["iam", "Microsoft Entra ID"], ["billing", "Cost Management + Billing"]],
      info: { directory: "Switch between organisational tenants (enterprise/university accounts).", search: "Find any resource or service.", compute: "Create and manage VMs.", storage: "Blob, file, queue and table storage.", rg: "Bundle related resources (VM + storage + network) as one manageable unit.", iam: "Identity and access (Microsoft Entra ID).", billing: "Budgets, alerts and free-credit tracking in one place.", dash: "Customisable: pin any resource or metric tile." } },
    gcp: { name: "Google Cloud Console", color: "#1A73E8", accent: "#FBBC04",
      top: [["project", "My Project ▾"], ["search", "Search resources, services, docs…"], ["shell", ">_ Cloud Shell"]],
      nav: [["menu", "☰ Navigation menu"], ["dash", "Dashboard"], ["compute", "Compute Engine"], ["storage", "Cloud Storage"], ["network", "VPC Network"], ["iam", "IAM & Admin"], ["billing", "Billing"]],
      info: { project: "Everything in GCP belongs to a Project — the core organising unit (comparable to an Azure Resource Group).", search: "Find any product.", shell: "A free, browser-based terminal: no local setup needed.", menu: "Searchable, collapsible list of all Google Cloud products.", compute: "Virtual machines.", storage: "Object storage buckets.", network: "Your VPC networks.", iam: "Who can do what.", billing: "Separate from resources; GCP is known for a simple pricing calculator.", dash: "Project overview." } },
  };
  const TABLE = [
    ["Organizing unit", { aws: "Account → Region", azure: "Subscription → Resource Group", gcp: "Organization → Project" }],
    ["Compute service", { aws: "EC2", azure: "Virtual Machines", gcp: "Compute Engine" }],
    ["Object storage", { aws: "S3", azure: "Storage Account (Blob)", gcp: "Cloud Storage" }],
    ["Identity & access", { aws: "IAM", azure: "Microsoft Entra ID", gcp: "Cloud IAM" }],
    ["Billing view", { aws: "Billing Dashboard", azure: "Cost Management", gcp: "Billing" }],
  ];
  const SCEN = [
    ["A student lab that runs for 2 hours, then is deleted", "On-Demand"],
    ["The university portal's database, running 24/7 for the next 3 years", "Reserved / Committed"],
    ["Nightly batch video encoding that can be restarted if interrupted", "Spot"],
    ["A new startup with unpredictable traffic in its first month", "On-Demand"],
  ];
  const answers = {};

  Lab.start({
    brief: `
<p>The original session was offline (campus power outage), so this lab recreates the <b>portal walkthrough</b>: explore conceptual layouts of the three big consoles, then compare their vocabulary, entry-level specs and pricing models.</p>
<h3>Objectives</h3>
<ol><li>Recognise the layout and core sections of a cloud console.</li><li>Find where compute, storage and billing live.</li><li>Compare entry VM specs across AWS, Azure, GCP and DigitalOcean.</li><li>Compare on-demand pricing and free tiers.</li><li>Tell on-demand, reserved/committed and spot pricing apart.</li></ol>
<div class="tbl-wrap"><table class="tbl"><tr><th>Provider</th><th>Entry instance</th><th>vCPU</th><th>RAM</th><th>On-demand (approx.)</th><th>Free tier</th></tr>
<tr><td>AWS</td><td>t3.micro</td><td>2 (burstable)</td><td>1 GiB</td><td>~$0.0104/h (~$7.59/mo)</td><td>750 h/mo t2/t3.micro, 12 months</td></tr>
<tr><td>Azure</td><td>B1s</td><td>1 (burstable)</td><td>1 GiB</td><td>~$0.0104/h (~$7.59/mo)</td><td>750 h/mo B1s, 12 months + $200 credit (30 days)</td></tr>
<tr><td>GCP</td><td>e2-micro</td><td>2 (shared)</td><td>1 GiB</td><td>~$0.0084/h (~$6.11/mo)</td><td>1 e2-micro Always Free (select US regions) + $300 (90 days)</td></tr>
<tr><td>DigitalOcean</td><td>Basic Droplet 1GB</td><td>1 (shared)</td><td>1 GB</td><td>flat $6.00/mo</td><td>No perpetual free tier</td></tr></table></div>
<p class="note">Prices are the reference figures from the lab slides (they change often and vary by region). Consoles here are conceptual layouts, not screenshots.</p>`,
    setup(api) {
      api.stage.append(api.dock());
      for (const [id, c] of Object.entries(CONSOLES)) {
        const info = h("p", { class: "mono-box", style: "white-space:normal" }, "Tap any part of the console.");
        const btn = ([k, t]) => h("button", { type: "button", class: "btn btn--ghost btn--s", style: "justify-content:flex-start", onclick: () => { flag.seen.add(id + ":" + k); info.textContent = `${t.replace(" ▾", "")} — ${c.info[k]}`; api.refresh(); } }, t);
        api.device(id, c.name.split(" ")[0] === "Microsoft" ? "Azure" : c.name.split(" ")[0], "console", h("div", { class: "win" },
          h("div", { class: "win-t", style: `background:${c.color};color:#fff` }, c.name),
          h("div", { class: "win-b" }, h("div", { class: "row" }, c.top.map(btn)), h("div", { style: "display:grid;gap:.35rem" }, c.nav.map(btn)), info)));
      }
      // cross-provider table
      const tbl = h("div", { class: "win-b" });
      const opts = { aws: TABLE.map((r) => r[1].aws), azure: TABLE.map((r) => r[1].azure), gcp: TABLE.map((r) => r[1].gcp) };
      tbl.append(h("p", { class: "panel-k" }, "Fill the cross-provider table — the anatomy is the same, the names differ"),
        ...TABLE.map(([row]) => h("div", { class: "field" }, h("span", null, row), h("div", { class: "row" }, ["aws", "azure", "gcp"].map((p) =>
          h("select", { "aria-label": `${row} ${p}`, onchange: (e) => { answers[row + p] = e.target.value; api.refresh(); } }, h("option", { value: "" }, p.toUpperCase() + "…"), [...opts[p]].sort().map((o) => h("option", null, o))))))));
      api.device("table", "Compare", "vocabulary table", h("div", { class: "win" }, h("div", { class: "win-t" }, "Every console shares the same anatomy"), tbl));
      // pricing models
      const pr = h("div", { class: "win-b" }, h("p", { class: "panel-k" }, "Pick the pricing model for each workload"),
        ...SCEN.map(([q], i) => h("div", { class: "field" }, h("span", null, q), h("select", { onchange: (e) => { answers["s" + i] = e.target.value; api.refresh(); } }, h("option", { value: "" }, "Choose…"), ["On-Demand", "Reserved / Committed", "Spot"].map((o) => h("option", null, o))))),
        h("p", { class: "panel-k" }, "Reflection: zero budget, personal project — which entry VM?"),
        h("select", { onchange: (e) => { answers.zero = e.target.value; api.refresh(); } }, h("option", { value: "" }, "Choose…"), ["AWS t3.micro", "Azure B1s", "GCP e2-micro", "DigitalOcean Basic Droplet"].map((o) => h("option", null, o))));
      api.device("pricing", "Pricing", "models", h("div", { class: "win" }, h("div", { class: "win-t" }, "On-Demand · Reserved · Spot"), pr));
    },
    tasks: [
      { title: "AWS: find the region selector, EC2 and the Billing Dashboard", where: "AWS console", check: () => ["aws:region", "aws:compute", "aws:billing"].every((k) => flag.seen.has(k)) },
      { title: "Azure: find Resource Groups, Cost Management and the directory switcher", where: "Azure console", check: () => ["azure:rg", "azure:billing", "azure:directory"].every((k) => flag.seen.has(k)) },
      { title: "GCP: find the Project selector, Cloud Shell and Billing", where: "GCP console", check: () => ["gcp:project", "gcp:shell", "gcp:billing"].every((k) => flag.seen.has(k)) },
      { title: "Fill the cross-provider table correctly", detail: "Organizing unit, compute, object storage, identity and billing for each provider.", where: "Compare tab", check: () => TABLE.every(([row, v]) => ["aws", "azure", "gcp"].every((p) => answers[row + p] === v[p])) },
      { title: "Match each workload to a pricing model", where: "Pricing tab", hint: "Reserved = commit 1–3 years for 30–60% off; Spot = up to 90% off but can be reclaimed.", check: () => SCEN.every(([, a], i) => answers["s" + i] === a) },
      { title: "Reflection: choose a zero-budget option you can defend", detail: "Look at the free-tier column in the Brief.", where: "Pricing tab", hint: "Only one offer is “Always Free” (in select US regions).", check: () => answers.zero === "GCP e2-micro" },
    ],
    doneText: "Same anatomy, different names: region/project selector, service navigation and a billing view — and three ways to pay for the same VM.",
    quiz: [
      { t: "match", q: "Match the organizing unit to the provider.", pairs: [["AWS", "Account → Region"], ["Azure", "Subscription → Resource Group"], ["GCP", "Organization → Project"]], src: "Cloud Lab 1, slide 6" },
      { t: "match", q: "Match the compute service to the provider.", pairs: [["AWS", "EC2"], ["Azure", "Virtual Machines"], ["GCP", "Compute Engine"]], src: "Cloud Lab 1, slide 6" },
      { t: "match", q: "Match the pricing model to its description.", pairs: [["On-Demand", "Pay per hour/second, no commitment, highest per-hour price"], ["Reserved / Committed", "Commit 1–3 years for 30–60% off"], ["Spot", "Unused capacity up to 90% off, can be reclaimed"]], src: "Cloud Lab 1, slide 9" },
      { t: "mcq", q: "What does “burstable” mean for t3.micro, B1s and e2-micro?", opts: ["Normal CPU use is capped low with short bursts to full speed allowed — fine for a lab, not for sustained heavy load", "They can add RAM automatically", "They are free forever", "They run on GPUs"], a: 0, src: "Cloud Lab 1, slide 7" },
      { t: "mcq", q: "Which GCP feature gives a free, browser-based terminal?", opts: ["Cloud Shell", "Cloud Storage", "Compute Engine", "IAM"], a: 0, src: "Cloud Lab 1, slide 5" },
      { t: "mcq", q: "In Azure, what bundles a VM, its storage and its network as one manageable unit?", opts: ["Resource Group", "Subscription", "Directory", "Blob"], a: 0, src: "Cloud Lab 1, slide 4" },
      { t: "tf", q: "DigitalOcean offers a perpetual free tier for its Basic Droplet.", a: false, why: "Only promotional credit; the Droplet is a flat $6/month.", src: "Cloud Lab 1, slide 8" },
      { t: "fill", q: "Which pricing model would you use for fault-tolerant batch jobs to save up to 90%?", a: ["Spot", "spot instances"], src: "Cloud Lab 1, slide 9" },
      { t: "short", q: "Summarise the lab in one sentence.", model: "All major consoles share the same anatomy — a region/project selector, service navigation and a billing view — and their entry-level VMs converge on about 1–2 vCPU / 1 GB, priced within a dollar or two of each other.",
        keys: [["anatomy", "same layout", "same shape"], ["billing"], ["1 gb", "1–2 vcpu", "1-2 vcpu", "entry"]], src: "Cloud Lab 1, slide 10" },
      { t: "mcq", q: "Which service model are EC2, Azure VMs and Compute Engine?", opts: ["IaaS", "PaaS", "SaaS", "DaaS"], a: 0, src: "Cloud Lecture 1, IaaS examples" },
    ],
  });
})();
