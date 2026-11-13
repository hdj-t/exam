// Web-security lab kit in the style of PortSwigger's Web Security Academy: a simulated
// vulnerable site, a browser that renders its HTML *safely* (payloads are parsed and
// their effect simulated; nothing from the lab is ever executed for real), Burp tools
// (Proxy history, Repeater, Intruder, Decoder), an exploit server with access log and an
// email client, and a simulated victim browser that follows SameSite cookie rules.
(() => {
  "use strict";
  const { h } = Lab;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const rid = (n = 32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
  const hex = (n = 16) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = { enc: (s) => btoa(unescape(encodeURIComponent(s))), dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")))) };
  const b64url = (s) => b64.enc(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

  // ---- MD5 (for the stay-logged-in cookie lab)
  function md5(str) {
    const s = unescape(encodeURIComponent(str));
    const k = [], r = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
    const n = ((s.length + 8) >> 6) + 1, w = new Array(n * 16).fill(0);
    for (let i = 0; i < s.length; i++) w[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
    w[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
    w[n * 16 - 2] = s.length * 8;
    let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let j = 0; j < n * 16; j += 16) {
      let [a, b, c, d] = [a0, b0, c0, d0];
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const t = d; d = c; c = b;
        const x = (a + f + k[i] + w[j + g]) | 0;
        b = (b + ((x << r[i]) | (x >>> (32 - r[i])))) | 0; a = t;
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    return [a0, b0, c0, d0].map((v) => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 255).toString(16).padStart(2, "0")).join("")).join("");
  }

  // ---- HTTP messages
  const REASON = { 200: "OK", 201: "Created", 302: "Found", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 500: "Internal Server Error", 504: "Gateway Timeout" };
  function parseUrl(u, base) {
    const x = new URL(u, base);
    return { host: x.host, path: x.pathname, search: x.search, query: Object.fromEntries(x.searchParams), href: x.href };
  }
  function parseCookies(s) { const o = {}; for (const p of (s || "").split(/;\s*/)) { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1); } return o; }
  function parseForm(s) { try { return Object.fromEntries(new URLSearchParams(s)); } catch { return {}; } }
  function reqToRaw(r) {
    const head = [`${r.method} ${r.target} ${r.version || "HTTP/2"}`, ...Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`)];
    return head.join("\n") + "\n\n" + (r.body || "");
  }
  function rawToReq(raw, fallbackHost) {
    const text = raw.replace(/\r\n/g, "\n");
    const sep = text.indexOf("\n\n");
    const headPart = sep >= 0 ? text.slice(0, sep) : text, body = sep >= 0 ? text.slice(sep + 2) : "";
    const lines = headPart.split("\n");
    const m = /^(\S+)\s+(\S+)(?:\s+(HTTP\/[\d.]+))?/.exec(lines[0] || "");
    if (!m) throw new Error("The first line must look like: GET /path HTTP/2");
    const headers = {};
    for (const l of lines.slice(1)) { const i = l.indexOf(":"); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    const hv = (n) => Object.entries(headers).find(([k]) => k.toLowerCase() === n)?.[1];
    const host = hv("host") || fallbackHost;
    const u = parseUrl(m[2], "https://" + host);
    const ct = (hv("content-type") || "").toLowerCase();
    return { method: m[1], target: m[2], version: m[3] || "HTTP/2", headers, hv, host, path: u.path, query: u.query, search: u.search, cookies: parseCookies(hv("cookie")), body, form: ct.includes("json") ? safeJson(body) : parseForm(body), raw: text };
  }
  const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };
  function resToRaw(r) {
    const body = r.body ?? "";
    const hs = { "Content-Type": r.type || "text/html; charset=utf-8", ...(r.headers || {}) };
    const lines = [`HTTP/2 ${r.status} ${REASON[r.status] || ""}`.trim(), ...Object.entries(hs).map(([k, v]) => `${k}: ${v}`), ...(r.setCookies || []).map((c) => `Set-Cookie: ${c}`), `Content-Length: ${new Blob([body]).size}`];
    return lines.join("\n") + "\n\n" + body;
  }

  // ---- a tiny JavaScript "executor": only recognises what lab payloads do, never evals
  function stripStrings(code) { // remove string literals and comments, keep the code around them
    let out = "", i = 0;
    while (i < code.length) {
      const c = code[i];
      if (c === "'" || c === '"' || c === "`") {
        i++;
        while (i < code.length && code[i] !== c) { if (code[i] === "\\") i++; if (c !== "`" && code[i] === "\n") break; i++; }
        i++; out += " STR ";
      } else if (c === "/" && code[i + 1] === "/") { while (i < code.length && code[i] !== "\n") i++; }
      else if (c === "/" && code[i + 1] === "*") { i = code.indexOf("*/", i + 2); i = i < 0 ? code.length : i + 2; }
      else { out += c; i++; }
    }
    return out;
  }
  function evalArg(a, ctx) {
    a = (a || "").trim();
    if (/^document\.cookie$/.test(a)) return ctx.cookieStr();
    if (/^document\.domain$/.test(a)) return ctx.host;
    if (/^window\.origin$/.test(a)) return "https://" + ctx.host;
    const lit = /^(['"`])([\s\S]*)\1$/.exec(a);
    if (lit) return lit[2];
    return a;
  }
  // run "code" in a page context. Returns true if something executed.
  function simulate(code, ctx, opts = {}) {
    const outside = opts.raw ? code : stripStrings(code);
    let ran = false;
    const call = /\b(alert|print|confirm|prompt)\s*(?:\(\s*([^()]*?)\s*\)|`([^`]*)`)/g;
    let m;
    const src = opts.raw ? code : code; // read args from the original text
    if (/\b(alert|print|confirm|prompt)\s*[(`]/.test(outside)) {
      while ((m = call.exec(src))) { ctx.dialog(m[1], m[1] === "print" ? "" : evalArg(m[2] ?? m[3], ctx)); ran = true; break; }
    }
    // exfiltration: fetch / Image / location / sendBeacon towards another host with document.cookie
    if (/document\.cookie/.test(code) && /(fetch|Image|location|sendBeacon|XMLHttpRequest|open)\b/.test(outside)) {
      const hm = /(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/i.exec(code);
      if (hm) { ctx.exfil(hm[1], ctx.cookieStr()); ran = true; }
    }
    if (/\.submit\s*\(\s*\)|requestSubmit\s*\(/.test(outside) && ctx.submitForm) { ctx.submitForm(); ran = true; }
    const nav = /(?:document\.|window\.)?location(?:\.href)?\s*=\s*(['"`])([^'"`]+)\1/.exec(code) || /location\.(?:assign|replace)\(\s*(['"`])([^'"`]+)\1\s*\)/.exec(code);
    if (nav && !/document\.cookie/.test(code) && ctx.navigate) { ctx.navigate(nav[2]); ran = true; }
    return ran;
  }

  // ---- safe renderer: parse HTML inertly, rebuild allowed elements, simulate scripts
  const OK_TAGS = new Set("div p span h1 h2 h3 h4 h5 a form input textarea button label section header nav footer img table thead tbody tr td th ul ol li strong b i em br hr code pre small select option iframe blockquote article aside main body html head title meta svg animate details summary".split(" "));
  const AUTO = { onerror: ["img", "video", "audio", "input", "iframe", "object", "source"], onload: ["svg", "body", "iframe", "img", "object", "style"], onbegin: ["animate", "set", "animatetransform"], onfocus: null, ontoggle: ["details"] };
  function render(html, ctx) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = h("div", { class: "wb-page" });
    const forms = [];
    const pending = [];
    const walk = (node, parent) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) { parent.append(n.data); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        if (tag === "script") { pending.push(() => simulate(n.textContent, ctx)); continue; }
        if (tag === "style" || tag === "link") continue;
        if (tag === "meta") { const c = n.getAttribute("content") || ""; const r = /url=(.+)$/i.exec(c); if (/refresh/i.test(n.getAttribute("http-equiv") || "") && r) pending.push(() => ctx.navigate?.(r[1].replace(/^['"]|['"]$/g, ""))); continue; }
        if (tag === "head" || tag === "title") { walk(n, parent); continue; }
        const el = document.createElement(OK_TAGS.has(tag) && !["html", "body", "head", "svg", "animate", "iframe", "img"].includes(tag) ? tag : tag === "img" || tag === "iframe" ? "span" : "div");
        if (tag === "img") { el.className = "wb-img"; el.textContent = n.getAttribute("alt") || "🖼"; }
        if (tag === "iframe") { el.className = "wb-iframe"; el.textContent = "[iframe " + (n.getAttribute("src") || "") + "]"; }
        for (const a of ["class", "name", "type", "placeholder", "value", "action", "method", "alt", "id", "for", "rows", "required", "maxlength", "readonly", "selected"]) if (n.hasAttribute(a)) el.setAttribute(a === "class" ? "data-c" : a, n.getAttribute(a));
        if (tag === "input" || tag === "textarea") el.value = n.getAttribute("value") ?? n.textContent ?? "";
        // event handlers
        for (const attr of [...n.attributes]) {
          const an = attr.name.toLowerCase();
          if (!an.startsWith("on")) continue;
          const code = attr.value;
          const auto = AUTO[an] ? AUTO[an].includes(tag) && (an !== "onerror" || tag === "body" || n.hasAttribute("src") || tag === "input") : an === "onfocus" && n.hasAttribute("autofocus");
          if (auto) pending.push(() => simulate(code, ctx, { raw: true }));
          else { el.classList.add("wb-has-handler"); el.title = `${an}=…`; el.addEventListener(an === "onmouseover" || an === "onmouseenter" ? "mouseenter" : "click", () => simulate(code, ctx, { raw: true })); }
        }
        if (tag === "img" && n.getAttribute("src") && ctx.subresource) pending.push(() => ctx.subresource(n.getAttribute("src")));
        if (tag === "iframe" && n.getAttribute("src")) { const s = n.getAttribute("src"); if (/^\s*javascript:/i.test(s)) pending.push(() => simulate(s.replace(/^\s*javascript:/i, ""), ctx, { raw: true })); else if (ctx.subresource) pending.push(() => ctx.subresource(s, "iframe")); }
        if (tag === "a") {
          const href = n.getAttribute("href") || "";
          el.setAttribute("href", "#");
          el.addEventListener("click", (e) => { e.preventDefault(); if (/^\s*javascript:/i.test(href)) simulate(decodeURIComponent(href.replace(/^\s*javascript:/i, "")), ctx, { raw: true }); else ctx.navigate?.(href); });
        }
        if (tag === "form") {
          forms.push(el);
          el.addEventListener("submit", (e) => { e.preventDefault(); ctx.submit?.(el, e.submitter); });
        }
        parent.append(el);
        walk(n, el);
      }
    };
    walk(doc.documentElement, out);
    ctx.submitForm = () => { const f = forms[0]; if (f) ctx.submit?.(f); };
    return { el: out, run: () => { for (const p of pending) p(); }, forms };
  }
  function formData(form) {
    const data = new URLSearchParams();
    for (const i of form.querySelectorAll("input, textarea, select")) if (i.name && !(i.type === "submit" || i.type === "button")) data.append(i.name, i.value);
    return data;
  }

  // ---- cookie jars
  class Jar {
    constructor() { this.c = {}; }
    set(host, line) {
      const [nv, ...attrs] = line.split(/;\s*/);
      const i = nv.indexOf("=");
      const name = nv.slice(0, i), value = nv.slice(i + 1);
      const a = Object.fromEntries(attrs.map((x) => { const [k, v] = x.split("="); return [k.toLowerCase(), v ?? true]; }));
      (this.c[host] ??= {})[name] = { value, httpOnly: !!a.httponly, secure: !!a.secure, sameSite: (a.samesite || "Lax").toString(), path: a.path || "/" };
      if (a["max-age"] === "0" || /1970/.test(a.expires || "")) delete this.c[host][name];
    }
    // cookies for a request; cross = initiated from another site; nav = top-level GET navigation
    header(host, { cross = false, method = "GET", nav = true } = {}) {
      const all = this.c[host] || {};
      return Object.entries(all).filter(([, c]) => {
        if (!cross) return true;
        const ss = c.sameSite.toLowerCase();
        if (ss === "none") return true;
        if (ss === "lax") return nav && method === "GET";
        return false;
      }).map(([k, c]) => `${k}=${c.value}`).join("; ");
    }
    jsCookie(host) { return Object.entries(this.c[host] || {}).filter(([, c]) => !c.httpOnly).map(([k, c]) => `${k}=${c.value}`).join("; "); }
  }

  // =====================================================================================
  // Web.lab({ title, host, setup(srv), challenges: [...], ... }) — wires browser, Burp,
  // exploit server and victim for one lecture's set of PortSwigger-style challenges.
  function lab(def) {
    const HOST = def.host || `0a${hex(15)}.web-security-academy.net`;
    const EXP = `exploit-0a${hex(15)}.exploit-server.net`;
    const EMAIL_HOST = `exploit-0a${hex(15)}.exploit-server.net`;
    const srv = {
      HOST, EXP, sessions: {}, users: {}, solved: {}, data: {}, emails: [],
      esc, rid, hex, md5, b64, b64url,
      session(req, res, opts = {}) {
        let sid = req.cookies.session;
        if (!sid || !srv.sessions[sid]) {
          sid = rid(32);
          srv.sessions[sid] = { user: null, csrf: rid(32) };
          res.setCookies.push(`session=${sid}; Secure; HttpOnly; SameSite=${opts.sameSite || def.sameSite || "None"}`);
        }
        return Object.assign(srv.sessions[sid], { id: sid });
      },
      login(s, res, user) { s.user = user; },
      page(title, body, s, extra = "") {
        return `<!DOCTYPE html><html><head><title>${esc(title)}</title>${extra}</head><body><div class="lab-head"><div class="lab-title">${esc(def.siteName || "Web Security Academy")}</div></div><header class="nav"><a href="/">Home</a> | <a href="/my-account">My account</a>${s && s.user ? ` | <a href="/logout">Log out</a>` : ""}</header><section class="content">${body}</section></body></html>`;
      },
      solve(id, msg) { if (srv.solved[id]) return; srv.solved[id] = true; toast?.(msg || "Congratulations, you solved the lab!"); drawBanner(); refresh?.(); },
      log: [], // exploit server access log
      sendEmail(to, subject, body) { srv.emails.unshift({ to, subject, body, time: new Date().toUTCString() }); drawEmails(); },
    };
    let toast, refresh;
    const exploit = { head: "HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8", body: "Hello, world!", file: "/exploit", files: {} };

    function handle(req) {
      const res = { status: 200, headers: {}, setCookies: [], body: "" };
      if (req.host === EXP || req.host === EMAIL_HOST) return exploitServer(req, res);
      const out = def.handle(req, res, srv) || res;
      return Object.assign(res, out === res ? {} : out);
    }
    function exploitServer(req, res) {
      srv.log.push(`${req.from === "victim" ? "10.0.4.79" : "193.168.17.2"}  ${new Date().toISOString().replace("T", " ").slice(0, 19)} +0000 "${req.method} ${req.target} HTTP/1.1" ${req.path === exploit.file || exploit.files[req.path] ? 200 : 404} "user-agent: Mozilla/5.0 (${req.from === "victim" ? "Victim" : "Windows NT 10.0; Win64; x64"}) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"`);
      drawLog();
      def.onExploitHit?.(req, srv);
      if (req.path === exploit.file || exploit.files[req.path]) { res.body = exploit.files[req.path] ?? exploit.body; res.type = /\.js$/.test(req.path) ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8"; return res; }
      res.status = 404; res.body = '"Not Found"'; res.type = "application/json; charset=utf-8";
      return res;
    }

    // ---------------- browsers
    function makeBrowser(who) {
      const jar = new Jar();
      const st = { url: null, history: [], who };
      const view = h("div", { class: "wb-view" });
      const addr = h("input", { class: "wb-addr", type: "text", autocapitalize: "off", autocomplete: "off", spellcheck: "false", "aria-label": "Address" });
      const dialogEl = h("div");
      const ctxFor = (host) => ({
        host,
        cookieStr: () => jar.jsCookie(host),
        dialog: (fn, v) => {
          def.onDialog?.(fn, v, { who, url: st.url, host }, srv);
          if (who === "you") dialogEl.replaceChildren(h("div", { class: "dialog wb-dialog" }, h("p", { class: "dialog-t" }, `${host} says`), h("p", { class: "mono-box" }, String(v)), h("button", { class: "btn btn--s", type: "button", onclick: () => dialogEl.replaceChildren() }, "OK")));
        },
        exfil: (toHost, data) => fetchReq({ method: "GET", url: `https://${toHost}/?${encodeURIComponent(data)}`, cross: true, nav: false }),
        navigate: (href) => go(new URL(href, st.url || "https://" + HOST).href, { cross: !!st.url && new URL(st.url).host !== new URL(href, st.url).host, initiator: st.url }),
        subresource: (src, kind) => { try { const u = new URL(src, st.url); if (u.host === HOST || u.host === EXP) fetchReq({ method: "GET", url: u.href, cross: new URL(st.url).host !== u.host, nav: false, quiet: true }); } catch {} },
        submit: (form, submitter) => {
          const method = (form.getAttribute("method") || "GET").toUpperCase();
          const action = new URL(form.getAttribute("action") || st.url, st.url).href;
          const data = formData(form);
          if (submitter?.name) data.append(submitter.name, submitter.value);
          const cross = new URL(action).host !== new URL(st.url).host;
          if (method === "GET") { const u = new URL(action); u.search = data.toString(); go(u.href, { cross }); }
          else go(action, { method: "POST", body: data.toString(), cross });
        },
      });
      function fetchReq({ method = "GET", url, body = "", cross = false, nav = true, quiet = false, extraHeaders = {} }) {
        const u = new URL(url);
        const cookie = jar.header(u.host, { cross, method, nav });
        const headers = { Host: u.host, ...(cookie ? { Cookie: cookie } : {}), "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", Accept: "text/html,application/xhtml+xml,*/*;q=0.8", ...(st.url ? { Referer: st.url } : {}), ...(cross && st.url ? { Origin: new URL(st.url).origin, "Sec-Fetch-Site": "cross-site" } : { "Sec-Fetch-Site": st.url ? "same-origin" : "none" }), ...extraHeaders };
        if (method === "POST") { headers["Content-Type"] = "application/x-www-form-urlencoded"; headers["Content-Length"] = String(body.length); }
        if (def.referrerPolicyNone?.(st.url)) delete headers.Referer;
        const raw = reqToRaw({ method, target: u.pathname + u.search, headers, body });
        const req = rawToReq(raw, u.host);
        req.from = who; req.cross = cross; req.nav = nav;
        const res = handle(req);
        for (const c of res.setCookies || []) jar.set(u.host, c);
        if (who === "you") history.push({ req: raw, res: resToRaw(res), host: u.host, method, path: u.pathname + u.search, status: res.status, len: (res.body || "").length });
        return res;
      }
      function go(url, opts = {}) {
        let res, u = url, hops = 0, method = opts.method || "GET", body = opts.body || "";
        for (;;) {
          res = fetchReq({ method, url: u, body, cross: opts.cross, nav: true });
          if (res.status === 302 && res.headers.Location && hops++ < 5) { u = new URL(res.headers.Location, u).href; method = "GET"; body = ""; opts.cross = false; continue; }
          break;
        }
        st.url = u;
        if (who === "you") { addr.value = u; drawHistory(); }
        const host = new URL(u).host;
        const isHtml = (res.type || "text/html").includes("html");
        if (!isHtml) { view.replaceChildren(h("pre", { class: "mono-box" }, res.body)); return res; }
        const r = render(res.body || "", ctxFor(host));
        if (who === "you") view.replaceChildren(r.el);
        if (res.client) { const extra = res.client(new URL(u)); const r2 = render(extra, ctxFor(host)); r.el.append(r2.el); setTimeout(r2.run, 30); }
        setTimeout(r.run, 30);
        def.onView?.(who, u, res, srv);
        return res;
      }
      addr.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); let v = addr.value.trim(); if (!/^https?:\/\//.test(v)) v = "https://" + v; try { go(v); } catch { toast("Not a valid URL"); } } });
      return { jar, st, go, fetchReq, view, addr, dialogEl, ctxFor };
    }
    const you = makeBrowser("you");
    const victim = makeBrowser("victim");
    srv.victim = victim; srv.you = you;

    // ---------------- Burp
    const history = [];
    const histList = h("div", { class: "list wb-hist" });
    let selected = null;
    const histDetail = h("div", { class: "wb-split" });
    function drawHistory() {
      histList.replaceChildren(...history.slice(-60).reverse().map((x, i) => h("button", { type: "button", class: "wb-hrow" + (selected === x ? " sel" : ""), onclick: () => { selected = x; drawHistory(); } },
        h("span", { class: "pill " + (x.status >= 400 ? "pill--bad" : x.status >= 300 ? "pill--warn" : "pill--ok") }, x.status), ` ${x.method} `, h("span", { class: "mono" }, x.path.length > 48 ? x.path.slice(0, 48) + "…" : x.path), h("small", null, ` ${x.host === HOST ? "" : x.host}`))));
      if (!history.length) histList.replaceChildren(h("div", null, "No requests yet. Browse the lab site in the Browser tab."));
      if (selected) histDetail.replaceChildren(
        h("div", { class: "row" }, h("button", { class: "btn btn--s", type: "button", onclick: () => toRepeater(selected.req, selected.host) }, "Send to Repeater"), h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => toIntruder(selected.req, selected.host) }, "Send to Intruder")),
        h("p", { class: "panel-k" }, "Request"), h("pre", { class: "mono-box wb-raw" }, selected.req), h("p", { class: "panel-k" }, "Response"), h("pre", { class: "mono-box wb-raw" }, selected.res.length > 6000 ? selected.res.slice(0, 6000) + "\n…" : selected.res));
      else histDetail.replaceChildren();
    }
    // Repeater
    const rpTarget = h("input", { type: "text", value: HOST, spellcheck: "false", autocapitalize: "off" });
    const rpReq = h("textarea", { class: "wb-ta", rows: 12, spellcheck: "false", autocapitalize: "off", "aria-label": "Request" });
    const rpRes = h("pre", { class: "mono-box wb-raw" }, "Response appears here.");
    const rpCL = h("input", { type: "checkbox", checked: true });
    function sendRepeater() {
      let raw = rpReq.value;
      try {
        if (rpCL.checked) raw = raw.replace(/^(content-length:\s*)\d+/im, (m, p) => p + new Blob([(raw.replace(/\r\n/g, "\n").split("\n\n").slice(1).join("\n\n")).replace(/\n/g, "\r\n")]).size);
        if (rpCL.checked) rpReq.value = raw;
        const req = rawToReq(raw, rpTarget.value.trim());
        req.host = rpTarget.value.trim() || req.host; req.from = "you"; req.via = "repeater";
        const res = handle(req);
        for (const c of res.setCookies || []) you.jar.set(req.host, c);
        rpRes.textContent = resToRaw(res);
        history.push({ req: raw, res: rpRes.textContent, host: req.host, method: req.method, path: req.target, status: res.status, len: (res.body || "").length });
        drawHistory();
        def.onRepeater?.(req, res, srv);
        refresh?.();
      } catch (e) { rpRes.textContent = "Error: " + e.message; }
    }
    function toRepeater(raw, host) { rpReq.value = raw; rpTarget.value = host; burpTab("repeater"); show?.("burp"); }
    // Intruder
    const inReq = h("textarea", { class: "wb-ta", rows: 10, spellcheck: "false", autocapitalize: "off", "aria-label": "Intruder request template" });
    const inPay = h("textarea", { class: "wb-ta", rows: 6, spellcheck: "false", autocapitalize: "off", placeholder: "One payload per line" });
    const inGrep = h("input", { type: "text", placeholder: "Grep - Match (optional)", spellcheck: "false" });
    const inProc = { prefix: h("input", { type: "text", placeholder: "prefix e.g. carlos:", spellcheck: "false", autocapitalize: "off" }), md5: h("input", { type: "checkbox" }), b64: h("input", { type: "checkbox" }), md5first: true };
    const inRes = h("div", { class: "ws-table-wrap" });
    let attacking = false;
    async function intrude() {
      if (attacking) return;
      const tpl = inReq.value;
      if ((tpl.match(/§/g) || []).length !== 2) return toast("Mark exactly one payload position with § … § (use “Add §”).");
      const pays = inPay.value.split("\n").map((x) => x.trim()).filter(Boolean);
      if (!pays.length) return toast("Add some payloads.");
      attacking = true;
      const rows = [];
      const table = h("table", { class: "ws-table" }, h("thead", null, h("tr", null, ["#", "Payload", "Status", "Length", inGrep.value ? `“${inGrep.value}”` : "—"].map((x) => h("th", null, x)))));
      const tb = h("tbody"); table.append(tb); inRes.replaceChildren(table);
      for (let k = 0; k < pays.length; k++) {
        let p = pays[k];
        if (inProc.md5.checked) p = md5(p);
        if (inProc.prefix.value) p = inProc.prefix.value + p;
        if (inProc.b64.checked) p = b64.enc(p);
        const raw = tpl.replace(/§[^§]*§/, p);
        let res;
        try { const req = rawToReq(raw, HOST); req.from = "you"; req.via = "intruder"; res = handle(req); } catch (e) { res = { status: 400, body: e.message }; }
        const hit = inGrep.value && (res.body || "").includes(inGrep.value);
        rows.push({ k, p: pays[k], status: res.status, len: resToRaw(res).length });
        tb.append(h("tr", { class: res.status === 302 ? "p-dup" : hit ? "p-icmp" : "" }, [k + 1, pays[k], res.status, resToRaw(res).length, inGrep.value ? (hit ? "✓" : "") : ""].map((x) => h("td", null, String(x)))));
        if (k % 5 === 4) await Lab.sleep(40);
      }
      attacking = false;
      def.onIntruder?.(rows, srv);
      refresh?.();
    }
    function toIntruder(raw, host) { inReq.value = raw; burpTab("intruder"); show?.("burp"); }
    function addMarks() {
      const s = inReq.selectionStart, e = inReq.selectionEnd, v = inReq.value;
      if (s === e) return toast("Select the value to attack first, then press Add §.");
      inReq.value = v.slice(0, s) + "§" + v.slice(s, e) + "§" + v.slice(e);
    }
    // Decoder
    const decIn = h("textarea", { class: "wb-ta", rows: 4, spellcheck: "false", autocapitalize: "off", placeholder: "Paste text to decode / encode" });
    const decOut = h("pre", { class: "mono-box" }, "");
    const decode = (kind) => {
      const v = decIn.value;
      try {
        decOut.textContent = { b64d: () => b64.dec(v.trim()), b64e: () => b64.enc(v), urld: () => decodeURIComponent(v.replace(/\+/g, " ")), urle: () => encodeURIComponent(v), htmle: () => esc(v), htmld: () => new DOMParser().parseFromString(v, "text/html").documentElement.textContent, md5: () => md5(v), jwt: () => v.trim().split(".").slice(0, 2).map((p) => JSON.stringify(JSON.parse(b64.dec(p)), null, 2)).join("\n.\n") + "\n.\n" + (v.split(".")[2] || "(no signature)") }[kind]();
        def.onDecode?.(kind, v, decOut.textContent, srv);
        refresh?.();
      } catch { decOut.textContent = "Can't decode that as " + kind.replace(/[de]$/, ""); }
    };
    const burpPanes = {
      proxy: h("div", { class: "win-b" }, h("p", { class: "panel-k" }, "Proxy › HTTP history (newest first)"), histList, histDetail),
      repeater: h("div", { class: "win-b" }, Kit.field("Target", rpTarget), h("textarea"), h("div", { class: "row" }, h("button", { class: "btn btn--s", type: "button", onclick: sendRepeater }, "Send"), h("label", { class: "row" }, rpCL, h("small", null, "Update Content-Length"))), h("p", { class: "panel-k" }, "Response"), rpRes),
      intruder: h("div", { class: "win-b" }, h("p", { class: "panel-k" }, "Positions — select a value, press Add §"), inReq, h("div", { class: "row" }, h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: addMarks }, "Add §"), h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => (inReq.value = inReq.value.replace(/§/g, "")) }, "Clear §")),
        h("p", { class: "panel-k" }, "Payloads (Sniper)"), inPay, h("p", { class: "panel-k" }, "Payload processing (in order: hash, prefix, encode)"),
        h("div", { class: "row" }, h("label", { class: "row" }, inProc.md5, h("small", null, "Hash: MD5")), inProc.prefix, h("label", { class: "row" }, inProc.b64, h("small", null, "Encode: Base64"))),
        Kit.field("Settings › Grep - Match", inGrep), h("button", { class: "btn btn--s", type: "button", onclick: intrude }, "Start attack"), inRes),
      decoder: h("div", { class: "win-b" }, decIn, h("div", { class: "row" }, ...[["b64d", "Decode Base64"], ["b64e", "Encode Base64"], ["urld", "Decode URL"], ["urle", "Encode URL"], ["htmle", "Encode HTML"], ["htmld", "Decode HTML"], ["md5", "Hash MD5"], ["jwt", "Decode JWT"]].map(([k, t]) => h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => decode(k) }, t))), decOut),
    };
    burpPanes.repeater.children[1].replaceWith(rpReq);
    const burpSeg = h("div", { class: "seg" });
    const burpBody = h("div");
    function burpTab(k) {
      for (const b of burpSeg.children) b.setAttribute("aria-pressed", b.dataset.k === k);
      burpBody.replaceChildren(burpPanes[k]);
      if (k === "proxy") drawHistory();
    }
    for (const [k, t] of [["proxy", "Proxy"], ["repeater", "Repeater"], ["intruder", "Intruder"], ["decoder", "Decoder"]]) if (!def.burp || def.burp.includes(k)) burpSeg.append(h("button", { type: "button", "data-k": k, onclick: () => burpTab(k) }, t));
    burpTab("proxy");
    const burpEl = h("div", { class: "win wb-burp" }, h("div", { class: "win-t" }, "Burp Suite Community Edition", h("small", null, "proxy on — browser traffic is recorded")), h("div", { style: "padding:.5rem .6rem 0" }, burpSeg), burpBody);

    // ---------------- exploit server
    const exHead = h("textarea", { class: "wb-ta", rows: 2, spellcheck: "false" });
    const exBody = h("textarea", { class: "wb-ta", rows: 8, spellcheck: "false", autocapitalize: "off", "aria-label": "Exploit body" });
    const exFile = h("input", { type: "text", spellcheck: "false", autocapitalize: "off" });
    exHead.value = exploit.head; exBody.value = exploit.body; exFile.value = exploit.file;
    const logBox = h("pre", { class: "mono-box wb-raw" }, "");
    const emailBox = h("div", { class: "list" });
    function store() { exploit.head = exHead.value; exploit.body = exBody.value; exploit.file = exFile.value.trim() || "/exploit"; exploit.files[exploit.file] = exploit.body; toast("Stored at https://" + EXP + exploit.file); }
    function drawLog() { logBox.textContent = srv.log.slice(-40).join("\n") || "(no requests yet)"; }
    function drawEmails() {
      emailBox.replaceChildren(...(srv.emails.length ? srv.emails.filter((e) => e.to.endsWith(EMAIL_HOST)).map((e) => h("div", null, h("small", null, `${e.time} · To: ${e.to}`), h("br"), h("b", null, e.subject), h("pre", { class: "mono-box" }, e.body),
        ...[...e.body.matchAll(/https?:\/\/\S+/g)].map((m) => h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { you.go(m[0]); show?.("browser"); } }, "Open link")))) : [h("div", null, "No emails.")]));
    }
    const exploitEl = h("div", { class: "win" }, h("div", { class: "win-t" }, "Exploit server", h("small", null, EXP)),
      h("div", { class: "win-b" },
        Kit.field("File", exFile), Kit.field("Head", exHead), Kit.field("Body", exBody),
        h("div", { class: "row" },
          h("button", { class: "btn btn--s", type: "button", onclick: store }, "Store"),
          h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { store(); you.go("https://" + EXP + exploit.file); show?.("browser"); } }, "View exploit"),
          h("button", { class: "btn btn--s", type: "button", onclick: () => { store(); deliver(); } }, "Deliver exploit to victim"),
          h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: () => { drawLog(); logBox.scrollIntoView({ block: "nearest" }); } }, "Access log")),
        h("p", { class: "panel-k" }, "Access log"), logBox,
        def.email !== false && h("p", { class: "panel-k" }, `Email client · wiener@${EMAIL_HOST}`), def.email !== false && emailBox));
    function deliver() {
      toast("Exploit delivered to the victim");
      setTimeout(() => { victim.go("https://" + EXP + exploit.file, { cross: true }); def.onDeliver?.(srv); refresh?.(); }, 600);
    }
    drawLog(); drawEmails();

    // ---------------- banner
    const banner = h("div", { class: "wb-banner" });
    function drawBanner() {
      const done = def.challenges.filter((c) => srv.solved[c.id]).length;
      banner.replaceChildren(h("span", { class: "wb-logo" }, "WEB SECURITY ACADEMY"), h("span", { class: "pill " + (done === def.challenges.length ? "pill--ok" : "") }, `${done}/${def.challenges.length} solved`));
    }
    drawBanner();
    const browserEl = h("div", { class: "win wb-browser" }, banner, h("div", { class: "wb-bar" },
      h("button", { class: "btn btn--ghost btn--s", type: "button", "aria-label": "Home", onclick: () => you.go("https://" + HOST + "/") }, "⌂"),
      you.addr, h("button", { class: "btn btn--ghost btn--s", type: "button", "aria-label": "Reload", onclick: () => you.go(you.st.url || "https://" + HOST + "/") }, "↻")),
      you.dialogEl, you.view,
      h("details", { class: "wb-cookies" }, h("summary", null, "DevTools › Cookies"), cookieEditor()));
    function cookieEditor() {
      const box = h("div", { class: "win-b" });
      const draw = () => {
        const c = you.jar.c[HOST] || {};
        box.replaceChildren(...Object.entries(c).map(([k, v]) => h("div", { class: "row" }, h("code", null, k), h("input", { type: "text", value: v.value, spellcheck: "false", style: "flex:1;min-inline-size:8rem", onchange: (e) => { v.value = e.target.value.trim(); toast(`Cookie ${k} updated`); } }), h("small", null, `${v.httpOnly ? "HttpOnly " : ""}${v.secure ? "Secure " : ""}SameSite=${v.sameSite}`))),
          h("button", { class: "btn btn--ghost btn--s", type: "button", onclick: draw }, "Refresh cookies"));
      };
      draw();
      return box;
    }
    let show;
    return {
      srv, you, victim, HOST, EXP, EMAIL_HOST, exploit, history, render, deliver,
      mount(api) {
        toast = api.toast; refresh = api.refresh; show = (id) => api.show(id);
        api.stage.append(api.dock());
        api.device("browser", "Browser", "lab site", browserEl);
        api.device("burp", "Burp Suite", "Proxy · Repeater · Intruder", burpEl);
        if (def.exploitServer !== false) api.device("exploit", "Exploit server", "+ email client", exploitEl);
        you.go("https://" + HOST + "/");
      },
      setExploit(body, file) { exBody.value = body; if (file) exFile.value = file; store(); },
      drawEmails, drawLog,
    };
  }

  // shared PortSwigger-style site skeleton pieces
  const blog = [
    { id: 1, title: "The Digital Fast", author: "Ann Other", body: "Mobile phones have taken over our lives, our homes and our holidays." },
    { id: 2, title: "Spider Web Security", author: "Bud Weiser", body: "Today the internet is as vital as electricity, and as easy to misuse." },
    { id: 3, title: "A Perfect World", author: "Phil MaChartin", body: "As the fight against crime goes on, we look at what the future could hold." },
  ];

  window.Web = { lab, md5, b64, b64url, esc, rid, hex, render, simulate, rawToReq, reqToRaw, resToRaw, blog, stripStrings };
})();
