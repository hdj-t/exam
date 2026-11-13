// Interactive lab engine: Brief / Lab / Quiz tabs, auto-checked tasks, terminals that
// work with a phone keyboard, a device dock, a topology diagram and a quiz engine.
// A lab file calls Lab.start({...}); see labs/README.md for the shape.
(() => {
  "use strict";

  // ------------------------------------------------------------------ helpers
  const h = (tag, props, ...kids) => {
    const el = document.createElementNS(tag.startsWith("svg:") ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml", tag.replace(/^svg:/, ""));
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.setAttribute("class", v);
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style") el.style.cssText = v;
      else if ((k === "value" || k === "checked" || k === "disabled" || k === "selected") && !tag.startsWith("svg:")) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const norm = (s) => String(s).toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

  // Cisco-style command comparison: each typed word may be a prefix of the expected word
  // ("sh port-sec add" = "show port-security address"); words with digits must match exactly.
  function cmdMatch(input, expected) {
    const a = norm(input).split(" "), b = norm(expected).split(" ");
    if (a.length !== b.length) return false;
    return a.every((w, i) => (/\d/.test(b[i]) ? w === b[i] : w.length >= Math.min(2, b[i].length) && b[i].startsWith(w)));
  }

  // ------------------------------------------------------------------ terminal
  class Term {
    constructor(o) {
      this.o = o;
      this.hist = [];
      this.hi = 0;
      this.busy = false;
      this.abort = false;
      this.pending = null;
      this.out = h("div", { class: "term-out", role: "log" });
      this.pr = h("span", { class: "term-pr" });
      this.inp = h("input", {
        class: "term-in", type: "text", autocapitalize: "off", autocomplete: "off", autocorrect: "off",
        spellcheck: "false", enterkeyhint: "send", "aria-label": o.label || "Command",
      });
      const form = h("form", { class: "term-line", onsubmit: (e) => { e.preventDefault(); this.submit(); } }, this.pr, this.inp);
      const key = (label, title, fn) => h("button", { type: "button", class: "tk", title, "aria-label": title, onclick: () => { fn(); if (!matchMedia("(pointer: coarse)").matches) this.inp.focus(); } }, label);
      const keys = h("div", { class: "term-keys" },
        o.complete && key("Tab", "Complete the word", () => this.complete()),
        key("↑", "Previous command", () => this.histMove(-1)),
        key("↓", "Next command", () => this.histMove(1)),
        o.help && key("?", "Show possible commands", () => this.help()),
        key("Ctrl+C", "Stop the running command", () => this.interrupt()),
        key("Clear", "Clear the screen", () => { this.out.textContent = ""; }),
      );
      this.el = h("div", { class: "term" + (o.theme ? " term--" + o.theme : "") }, this.out, form, keys);
      this.out.addEventListener("click", () => { if (!getSelection().toString()) this.inp.focus({ preventScroll: true }); });
      this.inp.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); this.histMove(-1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); this.histMove(1); }
        else if (e.key === "Tab" && o.complete) { e.preventDefault(); this.complete(); }
        else if ((e.key === "c" || e.key === "C") && e.ctrlKey && !getSelection().toString()) { e.preventDefault(); this.interrupt(); }
        else if (e.key === "z" && e.ctrlKey && o.ctrlZ) { e.preventDefault(); o.ctrlZ(this); this.setPrompt(); }
      });
      if (o.help) this.inp.addEventListener("input", () => { if (this.inp.value.endsWith("?") && !this.pending) this.help(); });
      this.setPrompt();
      if (o.banner) this.print(o.banner, "tl-dim");
    }
    setPrompt() { this.pr.textContent = this.pending ? this.pending.text : this.o.prompt(); }
    print(text = "", cls) {
      const line = h("div", { class: "tl" + (cls ? " " + cls : "") }, text);
      this.out.append(line);
      // keep long sessions light
      while (this.out.childNodes.length > 600) this.out.firstChild.remove();
      this.out.scrollTop = this.out.scrollHeight;
      this.o.onPrint?.(this);
      return line;
    }
    lines(text, cls) { for (const l of String(text).split("\n")) this.print(l, cls); }
    histMove(d) {
      if (!this.hist.length) return;
      this.hi = Math.max(0, Math.min(this.hist.length, this.hi + d));
      this.inp.value = this.hist[this.hi] ?? "";
      this.inp.setSelectionRange(this.inp.value.length, this.inp.value.length);
    }
    complete() { if (this.o.complete) this.inp.value = this.o.complete(this.inp.value, this); }
    help() {
      const v = this.inp.value.replace(/\?$/, "");
      this.print(this.o.prompt() + v + "?", "tl-cmd");
      this.lines(this.o.help(v, this));
      this.inp.value = v;
    }
    type(text) { this.inp.value = text; this.inp.focus(); this.inp.setSelectionRange(text.length, text.length); }
    // ask for a line of input from inside a running command (passwords, [confirm])
    ask(text, opts = {}) {
      return new Promise((resolve) => {
        this.pending = { text, resolve, secret: opts.secret };
        this.inp.type = opts.secret ? "password" : "text";
        this.setPrompt();
        this.inp.focus({ preventScroll: true });
      });
    }
    async submit(override) {
      const line = override ?? this.inp.value;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.inp.value = "";
        this.inp.type = "text";
        this.print(p.text + (p.secret ? "" : line), "tl-cmd");
        this.setPrompt();
        p.resolve(line);
        return;
      }
      if (this.busy) return;
      this.inp.value = "";
      this.print(this.o.prompt() + line, "tl-cmd");
      if (line.trim() && this.hist[this.hist.length - 1] !== line) this.hist.push(line);
      this.hi = this.hist.length;
      this.busy = true;
      this.abort = false;
      this.el.classList.add("is-busy");
      try { await this.o.exec(line, this); } catch (e) { this.print(String(e.message || e), "tl-err"); console.error(e); }
      this.busy = false;
      this.el.classList.remove("is-busy");
      this.setPrompt();
      this.o.after?.(line, this);
    }
    // sleep that stops early on Ctrl+C; returns false when interrupted
    async wait(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (this.abort) return false; await sleep(Math.min(60, end - Date.now())); }
      return !this.abort;
    }
    interrupt() {
      if (this.pending) { const p = this.pending; this.pending = null; this.inp.type = "text"; this.print(p.text + "^C", "tl-cmd"); this.setPrompt(); p.resolve(null); return; }
      if (this.busy) { this.abort = true; this.print("^C", "tl-cmd"); }
      else { this.print(this.o.prompt() + this.inp.value + "^C", "tl-cmd"); this.inp.value = ""; }
      this.o.onInterrupt?.(this);
    }
  }

  // ------------------------------------------------------------------ topology
  const ICON = {
    pc: '<rect x="-15" y="-13" width="30" height="20" class="i-body"/><rect x="-11" y="-9" width="22" height="12" class="i-scr"/><rect x="-4" y="7" width="8" height="4" class="i-body"/><rect x="-10" y="11" width="20" height="3" class="i-body"/>',
    laptop: '<rect x="-13" y="-12" width="26" height="17" class="i-body"/><rect x="-10" y="-9" width="20" height="11" class="i-scr"/><rect x="-17" y="5" width="34" height="4" class="i-body"/>',
    server: '<rect x="-12" y="-16" width="24" height="31" class="i-body"/><rect x="-8" y="-12" width="16" height="3" class="i-scr"/><rect x="-8" y="-6" width="16" height="3" class="i-scr"/><rect x="-8" y="0" width="16" height="3" class="i-scr"/>',
    switch: '<rect x="-20" y="-10" width="40" height="20" class="i-body"/><path d="M-12 -4h18v-3l6 5-6 5v-3h-18z M12 4h-18v3l-6-5 6-5v3h18z" class="i-scr"/>',
    router: '<rect x="-17" y="-14" width="34" height="28" rx="0" class="i-body"/><path d="M-1 -11h2v8h3l-4 4-4-4h3z M-1 11h2v-8h3l-4-4-4 4h3z M-14 -1v2h8v3l4-4-4-4v3z M14 -1v2h-8v3l-4-4 4-4v3z" class="i-scr"/>',
    cloud: '<path d="M-18 8h36v-6h-3v-5h-5v-5h-9v3h-6v5h-5v3h-8z" class="i-body"/>',
    kali: '<rect x="-13" y="-12" width="26" height="17" class="i-body"/><rect x="-10" y="-9" width="20" height="11" class="i-scr i-scr--red"/><rect x="-17" y="5" width="34" height="4" class="i-body"/>',
    fw: '<rect x="-16" y="-14" width="32" height="28" class="i-body"/><path d="M-12 -10h10v5h-10zM2 -10h10v5h-10zM-6 -3h12v5h-12zM-12 4h10v5h-10zM2 4h10v5h-10z" class="i-scr i-scr--red"/>',
  };
  class Topo {
    constructor(o) {
      this.o = o;
      this.svg = h("svg:svg", { viewBox: `0 0 ${o.w} ${o.h}`, class: "topo-svg", role: "img", "aria-label": o.label || "Network topology" });
      this.linkEls = o.links.map((l) => {
        const a = o.nodes.find((n) => n.id === l.a), b = o.nodes.find((n) => n.id === l.b);
        const g = h("svg:g", { class: "lk" });
        g.append(h("svg:line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        const lab = (n, m, t) => t && g.append(h("svg:text", { x: n.x + (m.x - n.x) * 0.3, y: n.y + (m.y - n.y) * 0.3 - 5, class: "lk-t", "text-anchor": "middle" }, t));
        lab(a, b, l.al); lab(b, a, l.bl);
        this.svg.append(g);
        return { l, g, a, b };
      });
      this.nodeEls = o.nodes.map((n) => {
        const g = h("svg:g", { class: "nd nd--" + n.kind, transform: `translate(${n.x} ${n.y})`, tabindex: o.onClick ? 0 : null, role: o.onClick ? "button" : null, "aria-label": n.label });
        g.innerHTML = `<rect x="-26" y="-22" width="52" height="44" class="nd-hit"/>` + ICON[n.kind];
        g.append(h("svg:text", { y: 30, "text-anchor": "middle", class: "nd-t" }, n.label));
        if (n.sub) g.append(h("svg:text", { y: 42, "text-anchor": "middle", class: "nd-s" }, n.sub));
        if (o.onClick) {
          g.addEventListener("click", () => o.onClick(n.id));
          g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onClick(n.id); } });
        }
        this.svg.append(g);
        return { n, g };
      });
      this.el = h("div", { class: "topo" }, this.svg);
    }
    // link state: "up" | "down" | "off" (not connected)
    update(linkState, nodeState) {
      for (const L of this.linkEls) L.g.setAttribute("class", "lk lk--" + (linkState?.(L.l) ?? "up"));
      for (const N of this.nodeEls) {
        const s = nodeState?.(N.n);
        N.g.setAttribute("class", `nd nd--${N.n.kind}${s ? " is-" + s : ""}`);
      }
    }
    select(id) { for (const N of this.nodeEls) N.g.classList.toggle("is-sel", N.n.id === id); }
    // move a packet along node ids; kind colours it
    async packet(path, kind = "icmp", label = "") {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || path.length < 2) return;
      const pos = (id) => this.o.nodes.find((n) => n.id === id);
      const p = h("svg:g", { class: "pk pk--" + kind });
      p.append(h("svg:rect", { x: -7, y: -5, width: 14, height: 10 }));
      if (label) p.append(h("svg:text", { y: -9, "text-anchor": "middle" }, label));
      this.svg.append(p);
      for (let i = 0; i < path.length - 1; i++) {
        const a = pos(path[i]), b = pos(path[i + 1]);
        if (!a || !b) continue;
        const steps = 8;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          p.setAttribute("transform", `translate(${a.x + (b.x - a.x) * t} ${a.y + (b.y - a.y) * t})`);
          await sleep(28);
        }
      }
      await sleep(80);
      p.remove();
    }
  }

  // ------------------------------------------------------------------ quiz
  const TYPE_LABEL = { mcq: "Choose one", multi: "Choose all that apply", tf: "True or false", fill: "Type the answer", cmd: "Type the command", order: "Put in order", match: "Match", short: "Short answer" };

  function Quiz(root, qs, key) {
    const best = store.get(key + ":best", null);
    const results = new Array(qs.length).fill(null);
    const score = h("p", { class: "qz-score" });
    const bar = h("div", { class: "qz-bar" }, h("i"));
    const head = h("div", { class: "qz-head" }, score, bar);
    const list = h("ol", { class: "qz-list", role: "list" });
    const foot = h("div", { class: "qz-foot" });
    root.append(h("p", { class: "qz-intro" }, `${qs.length} questions in mixed formats. Check each one as you go; the explanation shows the source in the handout or lecture.`), head, list, foot);

    const update = () => {
      const got = results.reduce((n, r) => n + (r ?? 0), 0);
      const done = results.filter((r) => r != null).length;
      score.innerHTML = `<b>${fmt(got)}</b> / ${qs.length} · ${done} answered${best != null ? ` · best ${fmt(best)}` : ""}`;
      bar.firstChild.style.inlineSize = (done / qs.length) * 100 + "%";
      if (done === qs.length) {
        const prev = store.get(key + ":best", -1);
        if (got > prev) store.set(key + ":best", got);
        foot.replaceChildren(
          h("p", { class: "qz-final" }, `Final score ${fmt(got)} / ${qs.length} (${Math.round((got / qs.length) * 100)}%)`, got / qs.length >= 0.8 ? " · well done." : " · review the red ones and try again."),
          h("div", { class: "qz-actions" },
            h("button", { class: "btn", type: "button", onclick: () => retry(true) }, "Retry wrong answers"),
            h("button", { class: "btn btn--ghost", type: "button", onclick: () => retry(false) }, "Start over")),
        );
      } else foot.replaceChildren();
      Lab._progress?.();
    };
    const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
    const items = qs.map((q, i) => renderQ(q, i, (r) => { results[i] = r; update(); }));
    list.append(...items.map((x) => x.el));
    function retry(onlyWrong) {
      items.forEach((it, i) => { if (!onlyWrong || results[i] !== 1) { it.reset(); results[i] = null; } });
      update();
      const first = items.find((_, i) => results[i] == null);
      first?.el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    update();
    return { results, total: qs.length };
  }

  function renderQ(q, i, report) {
    const fb = h("div", { class: "qz-fb", hidden: true });
    const body = h("div", { class: "qz-body" });
    const check = h("button", { class: "btn", type: "button" }, "Check");
    const el = h("li", { class: "qz-q", id: "q" + (i + 1) },
      h("p", { class: "qz-k" }, `Q${i + 1} · ${TYPE_LABEL[q.t]}`),
      h("div", { class: "qz-text", html: q.q }),
      body, h("div", { class: "qz-act" }, check), fb);
    let grade, lock;
    const name = "q" + i + "-" + Math.random().toString(36).slice(2, 7);
    const build = () => {
      body.replaceChildren();
      if (q.t === "mcq" || q.t === "multi" || q.t === "tf") {
        const opts = q.t === "tf" ? ["True", "False"] : q.opts;
        const order = q.t === "tf" || q.keep ? opts.map((_, k) => k) : shuffle(opts.map((_, k) => k));
        const inputs = order.map((k) => {
          const inp = h("input", { type: q.t === "multi" ? "checkbox" : "radio", name, value: k });
          body.append(h("label", { class: "qz-opt" }, inp, h("span", { html: opts[k] })));
          return inp;
        });
        const correct = q.t === "tf" ? [q.a ? 0 : 1] : [].concat(q.a);
        grade = () => {
          const picked = inputs.filter((x) => x.checked).map((x) => +x.value);
          if (!picked.length) return null;
          inputs.forEach((x) => {
            const lab = x.parentElement;
            lab.classList.toggle("is-right", correct.includes(+x.value));
            lab.classList.toggle("is-wrong", x.checked && !correct.includes(+x.value));
          });
          const ok = picked.length === correct.length && picked.every((p) => correct.includes(p));
          if (ok) return 1;
          if (q.t === "multi") {
            const hit = picked.filter((p) => correct.includes(p)).length, miss = picked.length - hit;
            return Math.max(0, (hit - miss) / correct.length) >= 0.5 ? 0.5 : 0;
          }
          return 0;
        };
        lock = () => inputs.forEach((x) => (x.disabled = true));
      } else if (q.t === "fill" || q.t === "cmd") {
        const inp = h("input", { type: "text", class: "qz-in" + (q.t === "cmd" ? " qz-in--mono" : ""), placeholder: q.ph || (q.t === "cmd" ? "Type the command" : "Your answer"), autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check.click(); } });
        body.append(inp);
        grade = () => {
          if (!inp.value.trim()) return null;
          const ok = [].concat(q.a).some((a) => a instanceof RegExp ? a.test(inp.value.trim()) : q.t === "cmd" ? cmdMatch(inp.value, a) : norm(inp.value) === norm(a));
          inp.classList.add(ok ? "is-right" : "is-wrong");
          return ok ? 1 : 0;
        };
        lock = () => (inp.disabled = true);
      } else if (q.t === "order") {
        let cur = shuffle(q.items.map((_, k) => k));
        if (cur.every((v, k) => v === k)) cur.reverse();
        const ol = h("ol", { class: "qz-order", role: "list" });
        const draw = () => {
          ol.replaceChildren(...cur.map((k, pos) => h("li", { class: "qz-oi" },
            h("span", { class: "qz-on" }, pos + 1),
            h("span", { class: "qz-ot", html: q.items[k] }),
            h("span", { class: "qz-ob" },
              h("button", { type: "button", "aria-label": "Move up", disabled: pos === 0, onclick: () => { [cur[pos - 1], cur[pos]] = [cur[pos], cur[pos - 1]]; draw(); } }, "▲"),
              h("button", { type: "button", "aria-label": "Move down", disabled: pos === cur.length - 1, onclick: () => { [cur[pos + 1], cur[pos]] = [cur[pos], cur[pos + 1]]; draw(); } }, "▼")))));
        };
        draw();
        body.append(ol);
        grade = () => {
          [...ol.children].forEach((li, pos) => li.classList.add(cur[pos] === pos ? "is-right" : "is-wrong"));
          const right = cur.filter((k, pos) => k === pos).length;
          return right === cur.length ? 1 : right / cur.length >= 0.6 ? 0.5 : 0;
        };
        lock = () => ol.querySelectorAll("button").forEach((b) => (b.disabled = true));
      } else if (q.t === "match") {
        const rights = shuffle(q.pairs.map((p) => p[1]));
        const sels = q.pairs.map(([l]) => {
          const s = h("select", { class: "qz-sel" }, h("option", { value: "" }, "Choose…"), rights.map((r) => h("option", { value: r }, r)));
          body.append(h("label", { class: "qz-m" }, h("span", { class: "qz-ml", html: l }), s));
          return s;
        });
        grade = () => {
          if (sels.some((s) => !s.value)) return null;
          let right = 0;
          sels.forEach((s, k) => { const ok = s.value === q.pairs[k][1]; right += ok; s.parentElement.classList.add(ok ? "is-right" : "is-wrong"); });
          return right === sels.length ? 1 : right / sels.length >= 0.6 ? 0.5 : 0;
        };
        lock = () => sels.forEach((s) => (s.disabled = true));
      } else if (q.t === "short") {
        const ta = h("textarea", { class: "qz-ta", rows: 3, placeholder: "Write your answer in your own words" });
        body.append(ta);
        grade = () => {
          if (!ta.value.trim()) return null;
          const v = norm(ta.value);
          const found = q.keys.map((alts) => [].concat(alts).some((a) => v.includes(norm(a))));
          const n = found.filter(Boolean).length / q.keys.length;
          fb.dataset.keys = JSON.stringify(q.keys.map((alts, k) => [[].concat(alts)[0], found[k]]));
          return n >= 0.75 ? 1 : n >= 0.4 ? 0.5 : 0;
        };
        lock = () => (ta.disabled = true);
      }
    };
    build();
    check.addEventListener("click", () => {
      const r = grade();
      if (r == null) { fb.hidden = false; fb.className = "qz-fb is-warn"; fb.textContent = "Answer first, then check."; return; }
      lock();
      check.hidden = true;
      el.classList.add(r === 1 ? "is-right" : r > 0 ? "is-part" : "is-wrong");
      const verdict = r === 1 ? "Correct" : r > 0 ? "Partly right" : "Not quite";
      let extra = "";
      if (q.t === "short") {
        const keys = JSON.parse(fb.dataset.keys || "[]");
        extra = `<p class="qz-model"><b>Model answer:</b> ${q.model}</p><p class="qz-keys">${keys.map(([k, ok]) => `<span class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${esc(k)}</span>`).join(" ")}</p>`;
      } else if (q.t === "fill" || q.t === "cmd") {
        const first = [].concat(q.a).find((a) => typeof a === "string");
        if (r !== 1 && first) extra = `<p class="qz-model"><b>Answer:</b> <code>${esc(first)}</code></p>`;
      } else if (q.t === "order" && r !== 1) {
        extra = `<ol class="qz-model-ol">${q.items.map((x) => `<li>${x}</li>`).join("")}</ol>`;
      } else if (q.t === "match" && r !== 1) {
        extra = `<ul class="qz-model-ol">${q.pairs.map(([a, b]) => `<li>${a} → <b>${esc(b)}</b></li>`).join("")}</ul>`;
      }
      fb.hidden = false;
      fb.className = "qz-fb " + (r === 1 ? "is-right" : r > 0 ? "is-part" : "is-wrong");
      fb.innerHTML = `<p class="qz-v">${verdict}${q.t === "short" ? " · marked by key ideas" : ""}</p>${extra}${q.why ? `<p class="qz-why">${q.why}</p>` : ""}${q.src ? `<p class="qz-src">Source: ${q.src}</p>` : ""}`;
      report(r);
    });
    return {
      el,
      reset() { el.classList.remove("is-right", "is-wrong", "is-part"); fb.hidden = true; check.hidden = false; build(); },
    };
  }

  // ------------------------------------------------------------------ lab shell
  const Lab = {
    h, sleep, esc, store, Term, Topo, cmdMatch, norm, shuffle,
    start(def) {
      const key = "lab:" + document.body.dataset.lab;
      const app = document.getElementById("app");
      app.replaceChildren();
      const tabs = document.getElementById("tabs");
      const panes = {};
      const tabBtns = {};
      const names = [["brief", "Brief"], ["lab", "Lab"], ["quiz", "Quiz"]];
      for (const [id, label] of names) {
        panes[id] = h("section", { class: "pane pane--" + id, id: "pane-" + id, role: "tabpanel", "aria-labelledby": "tab-" + id, hidden: true });
        tabBtns[id] = h("button", { type: "button", role: "tab", id: "tab-" + id, "aria-controls": "pane-" + id, class: "tab", onclick: () => show(id, true) }, h("span", null, label), h("small", { class: "tab-n" }));
        tabs.append(tabBtns[id]);
        app.append(panes[id]);
      }
      function show(id, user) {
        for (const [k] of names) { panes[k].hidden = k !== id; tabBtns[k].setAttribute("aria-selected", k === id); }
        store.set(key + ":tab", id);
        if (user) scrollTo({ top: 0 });
        history.replaceState(null, "", "#" + id);
      }

      // ---- brief
      panes.brief.append(h("div", { class: "brief", html: def.brief }),
        h("p", { class: "brief-go" }, h("button", { class: "btn", type: "button", onclick: () => show("lab", true) }, "Start the lab →"), " ", h("a", { class: "btn btn--ghost", href: document.body.dataset.guide }, "Open the handout")));

      // ---- lab
      const tasks = def.tasks;
      let lastCur = -2, ready = false;
      const done = tasks.map(() => false);
      const mission = h("div", { class: "mission", "aria-live": "polite" });
      const listBox = h("details", { class: "tasklist" });
      const stage = h("div", { class: "stage" });
      panes.lab.append(mission, listBox, stage);
      const toastEl = h("div", { class: "toast", role: "status", hidden: true });
      document.body.append(toastEl);
      let toastT;
      const toast = (msg) => {
        toastEl.textContent = msg; toastEl.hidden = false;
        clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), 2600);
      };

      // device dock: chips + one panel per device; panels persist so terminals keep history
      const dock = { chips: h("div", { class: "dock-chips", role: "tablist", "aria-label": "Devices" }), panels: h("div", { class: "dock-panels" }), items: {}, cur: null };
      const api = {
        h, Term, Topo, sleep, toast, stage, store,
        refresh: () => refresh(),
        device(id, label, sub, panel) {
          const chip = h("button", { type: "button", class: "dchip", role: "tab", onclick: () => api.show(id) }, h("b", null, label), sub && h("small", null, sub), h("i", { class: "dot", hidden: true }));
          const wrap = h("div", { class: "dpanel", hidden: true, role: "tabpanel", "aria-label": label }, panel);
          dock.chips.append(chip); dock.panels.append(wrap);
          dock.items[id] = { chip, wrap, panel };
          if (!dock.cur) api.show(id);
          return wrap;
        },
        show(id) {
          if (!dock.items[id]) return;
          dock.cur = id;
          for (const [k, it] of Object.entries(dock.items)) {
            it.wrap.hidden = k !== id;
            it.chip.setAttribute("aria-selected", k === id);
            if (k === id) it.chip.querySelector(".dot").hidden = true;
          }
          dock.chips.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
          api.onShow?.(id);
          const t = dock.items[id].wrap.querySelector(".term-out");
          if (t) t.scrollTop = t.scrollHeight;
        },
        ping(id) { if (dock.cur !== id && dock.items[id]) dock.items[id].chip.querySelector(".dot").hidden = false; },
        get current() { return dock.cur; },
        dock: () => h("div", { class: "dock" }, dock.chips, dock.panels),
        flag: {},
      };

      def.setup(api);

      function cur() { return done.findIndex((d) => !d); }
      function drawMission() {
        const i = cur();
        if (i === -1) {
          store.set(key + ":done", true);
          mission.className = "mission is-done";
          mission.replaceChildren(
            h("p", { class: "mission-k" }, `All ${tasks.length} tasks done`),
            h("h2", { class: "mission-t" }, "Lab complete ✓"),
            h("p", { class: "mission-d" }, def.doneText || "You reproduced the whole experiment. Now test yourself."),
            h("div", { class: "mission-b" }, h("button", { class: "btn", type: "button", onclick: () => show("quiz", true) }, "Take the quiz →")));
          return;
        }
        const t = tasks[i];
        mission.className = "mission";
        const hint = h("div", { class: "mission-h", hidden: true });
        const btns = h("div", { class: "mission-b" });
        if (t.hint) btns.append(h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { hint.hidden = false; hint.innerHTML = `<p>${t.hint}</p>`; } }, "Hint"));
        if (t.answer) btns.append(h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { hint.hidden = false; hint.innerHTML = (t.hint ? `<p>${t.hint}</p>` : "") + `<pre class="mission-code">${esc(t.answer)}</pre>`; } }, "Show answer"));
        if (t.type) btns.append(h("button", { class: "btn btn--s", type: "button", onclick: () => {
          const dev = typeof t.device === "function" ? t.device() : t.device;
          if (dev) api.show(dev);
          const text = typeof t.type === "function" ? t.type() : t.type;
          if (text) api.termOf?.(dev)?.type(text);
        } }, "Type it for me"));
        if (def.diagnose) btns.append(h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { hint.hidden = false; hint.innerHTML = `<p>${def.diagnose()}</p>`; } }, "Why isn't it working?"));
        mission.replaceChildren(
          h("p", { class: "mission-k" }, `Task ${i + 1} of ${tasks.length}`, t.where ? ` · ${t.where}` : ""),
          h("h2", { class: "mission-t", html: t.title }),
          t.detail && h("p", { class: "mission-d", html: t.detail }),
          btns, hint);
      }
      function drawList() {
        const n = done.filter(Boolean).length;
        listBox.replaceChildren(
          h("summary", null, h("span", null, "All tasks"), h("small", null, `${n}/${tasks.length} done`)),
          h("ol", { class: "tl-list", role: "list" }, tasks.map((t, i) => h("li", { class: done[i] ? "is-done" : i === cur() ? "is-cur" : "" }, h("span", { class: "tl-n" }, done[i] ? "✓" : i + 1), h("span", { html: t.title })))));
      }
      function refresh() {
        if (!ready) return;
        let fresh = [];
        tasks.forEach((t, i) => { if (!done[i]) { let ok = false; try { ok = !!t.check(api.flag); } catch (e) { console.warn(e); } if (ok) { done[i] = true; fresh.push(i); } } });
        if (fresh.length) toast("✓ " + tasks[fresh[fresh.length - 1]].title.replace(/<[^>]+>/g, ""));
        const c = cur();
        if (c !== lastCur || fresh.length) { drawMission(); drawList(); lastCur = c; }
        progress();
      }
      // ---- quiz
      const quiz = Quiz(panes.quiz, def.quiz, key);
      function progress() {
        const n = done.filter(Boolean).length;
        tabBtns.lab.querySelector(".tab-n").textContent = `${n}/${tasks.length}`;
        const a = quiz.results.filter((r) => r != null).length;
        tabBtns.quiz.querySelector(".tab-n").textContent = `${a}/${quiz.total}`;
      }
      Lab._progress = progress;
      ready = true;
      refresh();
      const want = location.hash.slice(1);
      show(names.some(([n]) => n === want) ? want : store.get(key + ":tab", "brief"));
      document.documentElement.classList.add("ready");
    },
  };
  window.Lab = Lab;
})();
