// Shared pieces for the non-Packet-Tracer labs: a generic shell, a Wireshark-style
// capture view with display filters, and small form helpers.
(() => {
  "use strict";
  const { h } = Lab;

  // ---- generic shell: commands = { name: async (argv, term, line) => {} }
  function shell(o) {
    return new Lab.Term({
      prompt: o.prompt, theme: o.theme, label: o.label, banner: o.banner, after: o.after, onInterrupt: o.onInterrupt,
      complete: o.complete,
      exec: async (line, t) => {
        const argv = line.trim().match(/"[^"]*"|\S+/g)?.map((x) => x.replace(/^"|"$/g, "")) || [];
        if (!argv.length) return;
        let key = argv[0];
        if (o.ci) key = key.toLowerCase();
        let fn = o.commands[key];
        if (!fn && o.alias) fn = o.commands[o.alias(key, argv)];
        if (!fn) return t.lines(o.notFound ? o.notFound(argv[0], argv) : `${argv[0]}: command not found`);
        await fn(argv, t, line);
      },
    });
  }

  // ---- Wireshark display filters: protocol names, field == value, !=, &&, ||, !, and/or/not
  function compile(expr) {
    const src = expr.trim();
    if (!src) return () => true;
    const toks = src.match(/\(|\)|&&|\|\||==|!=|!|[^\s()!=&|]+/g) || [];
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    const FIELDS = ["ip.addr", "ip.src", "ip.dst", "eth.addr", "eth.src", "eth.dst", "tcp.port", "udp.port", "tcp.dstport", "tcp.srcport", "arp.opcode", "icmp.type", "frame.number", "arp.src.proto_ipv4", "arp.dst.proto_ipv4"];
    const PROTOS = ["arp", "icmp", "dns", "tcp", "udp", "http", "ip", "eth", "stp", "tls", "dhcp", "ssdp", "mdns", "nbns", "llmnr"];
    function or() { let a = and(); while (peek() === "||" || peek() === "or") { next(); const l = a, r = and(); a = (p) => l(p) || r(p); } return a; }
    function and() { let a = not(); while (peek() === "&&" || peek() === "and") { next(); const l = a, r = not(); a = (p) => l(p) && r(p); } return a; }
    function not() { if (peek() === "!" || peek() === "not") { next(); const f = not(); return (p) => !f(p); } return atom(); }
    function atom() {
      const t = next();
      if (t == null) throw new Error("incomplete");
      if (t === "(") { const f = or(); if (next() !== ")") throw new Error("missing )"); return f; }
      const k = t.toLowerCase();
      if (peek() === "==" || peek() === "!=" || peek() === "eq" || peek() === "ne") {
        const op = next(), v = next();
        if (v == null || !FIELDS.includes(k)) throw new Error("bad field");
        const val = v.toLowerCase();
        const test = (p) => [].concat(p.f[k] ?? []).map((x) => String(x).toLowerCase()).includes(val);
        return op === "==" || op === "eq" ? test : (p) => !test(p);
      }
      if (PROTOS.includes(k)) return (p) => p.layers.includes(k);
      if (FIELDS.includes(k)) return (p) => p.f[k] != null;
      throw new Error("unknown");
    }
    const f = or();
    if (i < toks.length) throw new Error("trailing");
    return f;
  }

  // packet: { time, src, dst, proto, len, info, layers:[...], f:{field: value|[values]}, cls }
  function wireshark(o = {}) {
    const rows = [];
    let filter = () => true, applied = "";
    const inp = h("input", { type: "text", placeholder: "Apply a display filter … <Ctrl-/>", autocapitalize: "off", autocomplete: "off", spellcheck: "false", "aria-label": "Display filter" });
    const startBtn = h("button", { class: "btn btn--s", type: "button", onclick: () => api.running ? api.stop() : api.start() }, "▶ Start");
    const applyBtn = h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => apply() }, "Apply");
    const status = h("p", { class: "topo-note" }, o.idle || "Not capturing. Choose the interface and press Start.");
    const tbody = h("tbody");
    const table = h("table", { class: "ws-table" }, h("thead", null, h("tr", null, ["No.", "Time", "Source", "Destination", "Protocol", "Length", "Info"].map((x) => h("th", null, x)))), tbody);
    const ifSel = o.ifaces ? h("select", { class: "qz-sel", style: "max-inline-size:12rem", "aria-label": "Interface" }, o.ifaces.map((x) => h("option", null, x))) : null;
    const el = h("div", { class: "ws" },
      h("div", { class: "ws-bar" }, ifSel, startBtn),
      h("div", { class: "ws-bar" }, inp, applyBtn),
      h("div", { class: "ws-table-wrap" }, table), status);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });
    inp.addEventListener("input", () => { try { compile(inp.value); inp.classList.remove("is-bad"); } catch { inp.classList.add("is-bad"); } });
    function apply() {
      try { filter = compile(inp.value); inp.classList.remove("is-bad"); applied = inp.value.trim(); }
      catch { inp.classList.add("is-bad"); status.textContent = `"${inp.value}" isn't a valid display filter.`; return; }
      draw();
      o.onFilter?.(applied, rows.filter(filter));
    }
    let t0 = 0;
    function draw() {
      const shown = rows.filter((p) => filter(p));
      tbody.replaceChildren(...shown.slice(-300).map((p) => h("tr", { class: "p-" + (p.cls || p.proto.toLowerCase()) }, [p.no, p.time, p.src, p.dst, p.proto, p.len, p.info].map((x) => h("td", null, x)))));
      const wrap = table.parentElement;
      wrap.scrollTop = wrap.scrollHeight;
      status.textContent = `${api.running ? "Capturing" : "Stopped"} · Packets: ${rows.length} · Displayed: ${shown.length}${applied ? ` · filter: ${applied}` : ""}`;
    }
    const api = {
      el, rows, running: false,
      get filter() { return applied; },
      get iface() { return ifSel?.value; },
      start() {
        if (ifSel && o.okIface && !o.okIface(ifSel.value)) { status.textContent = `No packets on ${ifSel.value}. Pick the active interface.`; return; }
        api.running = true; startBtn.textContent = "■ Stop"; rows.length = 0; t0 = performance.now(); draw(); o.onStart?.();
      },
      stop() { api.running = false; startBtn.textContent = "▶ Start"; draw(); o.onStop?.(); },
      add(p) {
        if (!api.running) return;
        p.no = rows.length + 1;
        p.time = ((performance.now() - t0) / 1000).toFixed(6);
        p.len ??= 60;
        rows.push(p);
        draw();
      },
      draw,
    };
    return api;
  }

  // labelled input / select / radio helpers for app-window panels
  const field = (label, input) => h("label", { class: "field" }, h("span", null, label), input);
  const radios = (name, opts, value, onchange) => h("div", { class: "choice", role: "radiogroup" }, opts.map(([v, t, sub]) => h("label", null,
    h("input", { type: "radio", name, value: v, checked: v === value, onchange: () => onchange(v) }), h("span", null, t, sub && h("small", null, sub)))));
  const win = (title, sub, ...body) => h("div", { class: "win" }, h("div", { class: "win-t" }, title, sub && h("small", null, sub)), h("div", { class: "win-b" }, ...body));

  window.Kit = { shell, wireshark, compileFilter: compile, field, radios, win };
})();
