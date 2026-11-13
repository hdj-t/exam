// Cloud Computing · Lab 2 — Hosting Specs and Pricing (price the same workload on three providers).
(() => {
  const { h } = Lab;
  // PRACTICE price sheet for this exercise only — not live quotes (the handout says prices change; cite the date).
  const P = {
    aws: { name: "AWS", regions: [["me-central-1 (UAE)", 1.1, true], ["me-south-1 (Bahrain)", 1.1, true], ["eu-central-1 (Frankfurt)", 1.05], ["us-east-1 (N. Virginia)", 1]],
      inst: [["t3.small", 2, 2, 0.0208], ["t3.medium", 2, 4, 0.0416], ["c5.large", 2, 4, 0.085], ["t3.large", 2, 8, 0.0832], ["m5.large", 2, 8, 0.096]], ssd: 0.08, egress: 0.09, free: 100 },
    azure: { name: "Azure", regions: [["UAE North (Dubai)", 1.1, true], ["Qatar Central (Doha)", 1.1, true], ["Germany West Central", 1.05], ["East US", 1]],
      inst: [["B1ms", 1, 2, 0.0207], ["B2s", 2, 4, 0.0416], ["F2s v2", 2, 4, 0.0846], ["B2ms", 2, 8, 0.0832], ["D2s v5", 2, 8, 0.096]], ssd: 0.096, egress: 0.087, free: 100 },
    gcp: { name: "Google Cloud", regions: [["me-central1 (Doha)", 1.1, true], ["me-central2 (Dammam)", 1.1, true], ["europe-west3 (Frankfurt)", 1.05], ["us-central1 (Iowa)", 1]],
      inst: [["e2-small", 2, 2, 0.0168], ["e2-medium", 2, 4, 0.0335], ["c2-standard-4", 4, 16, 0.2088], ["e2-standard-2", 2, 8, 0.067], ["n2-standard-2", 2, 8, 0.0971]], ssd: 0.17, egress: 0.12, free: 0 },
  };
  const NEED = { vcpu: 2, ram: 4, ssd: 50, out: 500, hours: 730 };
  const sel = { aws: {}, azure: {}, gcp: {} };
  const ans = {};
  const money = (x) => "$" + x.toFixed(2);
  function cost(id) {
    const p = P[id], s = sel[id];
    const r = p.regions.find((x) => x[0] === s.region), i = p.inst.find((x) => x[0] === s.inst);
    if (!r || !i || s.ssd == null || s.out == null) return null;
    const compute = i[3] * r[1] * NEED.hours, storage = s.ssd * p.ssd * r[1], data = Math.max(0, s.out - p.free) * p.egress;
    return { compute, storage, data, month: compute + storage + data, year: (compute + storage + data) * 12 };
  }
  const HIDDEN = [["Data egress (traffic leaving the cloud)", true], ["Public IP addresses", true], ["Snapshots and backups", true], ["Load balancer", true], ["Monitoring and logs", true], ["Support plans", true], ["Licenses (Windows, SQL Server)", true], ["Idle resources (forgotten VM or disk)", true], ["Ingress (traffic coming in)", false], ["Opening the web console", false]];
  const FAM = [["Web servers, small databases, dev/test", "General purpose"], ["Batch processing, encoding, game servers", "Compute optimized"], ["In-memory caches, large databases, analytics", "Memory optimized"], ["High-IOPS databases, data warehouses", "Storage optimized"], ["Machine learning, rendering", "GPU / accelerated"]];
  const SEC = [["Region and data residency", true], ["Encryption at rest and in transit by default", true], ["MFA, roles and least privilege", true], ["Availability SLA", true], ["ISO 27001 / SOC 2 certifications", true], ["Backup and exit costs", true], ["The console's colour scheme", false], ["The provider's logo size", false]];

  Lab.start({
    brief: `
<p>Read a server specification, then estimate the real monthly cost of the same workload on <b>AWS, Azure and Google Cloud</b>, spot the hidden costs, and judge offers on <b>security, not price alone</b>.</p>
<h3>Scenario: a university student portal (web app + database)</h3>
<div class="tbl-wrap"><table class="tbl"><tr><th>vCPU</th><th>Memory</th><th>SSD</th><th>Outbound / month</th><th>OS</th><th>Running</th></tr><tr><td>2</td><td>4 GB</td><td>50 GB</td><td>500 GB</td><td>Linux</td><td>730 h (24/7)</td></tr></table></div>
<h3>Rules</h3><ul><li>Pick one region <b>close to Iraq's users</b>, with the same logic on all three providers.</li><li>Choose the <b>cheapest instance that still meets</b> the requirement (not the biggest).</li><li>Use on-demand pricing for the main table.</li></ul>
<p class="note">This workbench uses a <b>practice price sheet</b> so the arithmetic can be checked. In the real lab use the official calculators (calculator.aws, azure.microsoft.com/pricing/calculator, cloud.google.com/products/calculator) and write down the date — prices change.</p>`,
    setup(api) {
      api.stage.append(api.dock());
      for (const id of ["aws", "azure", "gcp"]) {
        const p = P[id], s = sel[id];
        const out = h("div", { class: "list" });
        const draw = () => {
          const c = cost(id);
          out.replaceChildren(...(c ? [["Compute / month", c.compute], ["Storage / month", c.storage], ["Data transfer / month", c.data], ["Total / month", c.month], ["Total / year (×12)", c.year]].map(([k, v]) => h("div", { style: "display:flex;justify-content:space-between" }, h("span", null, k), h("b", null, money(v)))) : [h("div", null, "Fill in all four fields.")]));
          api.refresh();
        };
        const select = (label, key, options) => Kit.field(label, h("select", { onchange: (e) => { s[key] = e.target.value; draw(); } }, h("option", { value: "" }, "Choose…"), options.map((o) => h("option", { value: o[0] }, o[1] || o[0]))));
        const num = (label, key) => Kit.field(label, h("input", { type: "number", inputmode: "numeric", min: 0, oninput: (e) => { s[key] = e.target.value === "" ? null : +e.target.value; draw(); } }));
        api.device(id, p.name, "calculator", h("div", { class: "win" }, h("div", { class: "win-t" }, `${p.name} pricing calculator`, h("small", null, "practice sheet")), h("div", { class: "win-b" },
          select("Region", "region", p.regions.map((r) => [r[0]])),
          select("Instance", "inst", p.inst.map((i) => [i[0], `${i[0]} — ${i[1]} vCPU, ${i[2]} GB — $${i[3]}/h base`])),
          num("SSD storage (GB)", "ssd"), num("Outbound data transfer (GB / month)", "out"),
          h("p", { class: "ipf-note" }, `Storage $${p.ssd}/GB-month · egress $${p.egress}/GB after ${p.free} GB free · region factor applies to compute and storage`), out)));
      }
      const checks = (list, key) => h("div", { class: "choice" }, list.map(([t], i) => h("label", null, h("input", { type: "checkbox", onchange: (e) => { (ans[key] ??= new Set())[e.target.checked ? "add" : "delete"](i); api.refresh(); } }), h("span", null, t))));
      const pick = (label, key, opts) => Kit.field(label, h("select", { onchange: (e) => { ans[key] = e.target.value; api.refresh(); } }, h("option", { value: "" }, "Choose…"), opts.map((o) => h("option", null, o))));
      api.device("report", "Report", "decide", h("div", { class: "win" }, h("div", { class: "win-t" }, "Comparison and recommendation"), h("div", { class: "win-b" },
        pick("Cheapest provider for this workload (from your table)", "cheapest", ["AWS", "Azure", "Google Cloud"]),
        h("p", { class: "panel-k" }, "Hidden costs that change the bill (tick all that really add cost)"), checks(HIDDEN, "hidden"),
        h("p", { class: "panel-k" }, "Match the workload to the instance family"),
        ...FAM.map(([w], i) => pick(w, "fam" + i, ["General purpose", "Compute optimized", "Memory optimized", "Storage optimized", "GPU / accelerated"])),
        h("p", { class: "panel-k" }, "Security & compliance questions to ask before choosing (tick the real ones)"), checks(SEC, "sec"))));
    },
    tasks: [
      { title: "Price the portal on AWS", detail: "Region close to Iraq, the cheapest instance with 2 vCPU / 4 GB, 50 GB SSD, 500 GB out.", where: "AWS tab", hint: "Middle East regions are UAE and Bahrain. t3.small has only 2 GB RAM.",
        check: () => P.aws.regions.find((r) => r[0] === sel.aws.region)?.[2] && sel.aws.inst === "t3.medium" && sel.aws.ssd === 50 && sel.aws.out === 500 },
      { title: "Price it on Azure", where: "Azure tab", hint: "B1ms has 1 vCPU / 2 GB — too small.", check: () => P.azure.regions.find((r) => r[0] === sel.azure.region)?.[2] && sel.azure.inst === "B2s" && sel.azure.ssd === 50 && sel.azure.out === 500 },
      { title: "Price it on Google Cloud", where: "GCP tab", hint: "e2-small has 2 GB RAM.", check: () => P.gcp.regions.find((r) => r[0] === sel.gcp.region)?.[2] && sel.gcp.inst === "e2-medium" && sel.gcp.ssd === 50 && sel.gcp.out === 500 },
      { title: "Name the cheapest provider from your own table", where: "Report", check: () => { const c = ["aws", "azure", "gcp"].map((k) => [k, cost(k)?.month]); if (c.some((x) => x[1] == null)) return false; const best = c.sort((a, b) => a[1] - b[1])[0][0]; return ans.cheapest === P[best].name; } },
      { title: "Spot every hidden cost", detail: "Tick the eight that really change the bill, and none of the decoys.", where: "Report", check: () => { const s = ans.hidden || new Set(); return HIDDEN.every(([, ok], i) => s.has(i) === ok); } },
      { title: "Match workloads to instance families", where: "Report", check: () => FAM.every(([, f], i) => ans["fam" + i] === f) },
      { title: "List the security questions that matter", detail: "“Cheapest is not always best.”", where: "Report", check: () => { const s = ans.sec || new Set(); return SEC.every(([, ok], i) => s.has(i) === ok); } },
    ],
    doneText: "Same requirement, three bills — and the decision still hangs on residency, encryption, identity, SLA, certifications and exit costs.",
    quiz: [
      { t: "match", q: "Match each spec item to what it means.", pairs: [["vCPU", "Virtual processor cores"], ["Memory (RAM)", "Working memory; databases and caches need lots"], ["Storage", "SSD/HDD, size and IOPS"], ["Network", "Bandwidth and billed outbound transfer"], ["Region and zone", "Where the server lives: latency, price, data residency"]], src: "Cloud Lab 2, slide 3" },
      { t: "mcq", q: "Which traffic is usually billed?", opts: ["Outbound (egress) data leaving the cloud", "Inbound (ingress) data", "Traffic inside one VM", "Console logins"], a: 0, src: "Cloud Lab 2, slides 3 and 7" },
      { t: "mcq", q: "Burstable instances (AWS T, Azure B) are…", opts: ["Cheap but throttle under sustained load", "The most expensive but fastest", "Only for GPUs", "Always free"], a: 0, src: "Cloud Lab 2, slide 4" },
      { t: "match", q: "Match the workload to the instance family.", pairs: FAM.map(([w, f]) => [w, f]), src: "Cloud Lab 2, slide 4" },
      { t: "multi", q: "Which are hidden costs from the lab? (Choose all that apply)", opts: ["Public IP addresses", "Snapshots and backups", "Load balancer", "Support plans", "Ingress traffic"], a: [0, 1, 2, 3], src: "Cloud Lab 2, slide 7" },
      { t: "fill", q: "A server running all month (24/7) is billed for about ___ hours.", a: ["730"], src: "Cloud Lab 2, slide 5" },
      { t: "mcq", q: "Why must you note the date you took the prices?", opts: ["Prices change often, so a quote is only valid for its date", "Calculators expire after a day", "Regions close at night", "It's needed for the SSH key"], a: 0, src: "Cloud Lab 2, slides 2 and 8" },
      { t: "short", q: "Why is the cheapest offer not always the best? Give two security reasons.", model: "Price ignores where the data sits (residency/legal), whether it's encrypted at rest and in transit by default, identity controls (MFA, roles, least privilege), the SLA, published certifications (ISO 27001, SOC 2) and how costly it is to back up and leave.",
        keys: [["residency", "region", "where"], ["encrypt"], ["mfa", "least privilege", "identity", "roles"], ["sla", "certification", "iso", "soc", "exit", "backup"]], src: "Cloud Lab 2, slide 9" },
      { t: "mcq", q: "Which region logic did the lab ask for?", opts: ["One region close to Iraq's users, same logic on all three providers", "The cheapest region anywhere", "A different continent for each provider", "Always us-east-1"], a: 0, src: "Cloud Lab 2, slide 5" },
    ],
  });
})();
