// Web Applications Security · Weeks 1–2 — HTTP in practice, as PortSwigger-style challenges.
(() => {
  const { esc } = Web;
  const USERS = ["carlos", "root", "admin", "test", "guest", "info", "adm", "mysql", "user", "administrator", "oracle", "ftp", "pi", "puppet", "ansible", "ec2-user", "vagrant", "azureuser", "academico", "acceso", "access", "accounting", "accounts", "acid", "activestat", "ad", "adam", "adkit", "admin1", "agenda", "ajax", "akamai", "alabama", "alaska", "albuquerque", "alerts", "alpha", "amarillo"];
  const PASSWORDS = ["123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567", "dragon", "123123", "baseball", "abc123", "football", "monkey", "letmein", "shadow", "master", "666666", "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321", "superman", "1qaz2wsx", "7777777", "121212", "000000", "qazwsx", "123qwe", "killer", "trustno1", "jordan", "jennifer", "zxcvbnm", "asdfgh", "hunter", "buster"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const victimUser = pick(USERS.slice(10)), victimPass = pick(PASSWORDS);
  const accounts = { wiener: { pass: "peter", role: "NORMAL" }, carlos: { pass: Web.rid(12), role: "NORMAL" }, administrator: { pass: Web.rid(12), role: "ADMIN" }, [victimUser]: { pass: victimPass, role: "NORMAL" } };
  const resets = {};

  const W = Web.lab({
    siteName: "HTTP Playground — Weeks 1–2",
    handle(req, res, srv) {
      const s = srv.session(req, res);
      const p = req.path;
      const nav = `<p><a href="/c1/login">1. Login (username enumeration)</a> · <a href="/c2/admin">2. Admin panel (method-based access)</a> · <a href="/c3/forgot-password">3. Forgot password (Host header)</a></p>`;
      if (p === "/") { res.body = srv.page("Home", `<h1>Weeks 1–2 — HTTP in practice</h1><p>Your account: <b>wiener / peter</b>. Watch every request in Burp.</p>${nav}`, s); return; }
      if (p === "/my-account") {
        if (!s.user) { res.status = 302; res.headers.Location = "/c1/login"; return; }
        if (s.user === victimUser) srv.solve("c1", `Challenge 1 solved: logged in as ${victimUser}`);
        if (s.user === "carlos" && s.viaReset) srv.solve("c3", "Challenge 3 solved: you took over carlos's account with a poisoned reset link");
        res.body = srv.page("My account", `<h1>My Account</h1><p>Your username is: <b>${esc(s.user)}</b></p><p>Role: ${accounts[s.user]?.role}</p>`, s);
        return;
      }
      if (p === "/logout") { s.user = null; res.status = 302; res.headers.Location = "/"; return; }
      // ---- 1: username enumeration via different responses
      if (p === "/c1/login") {
        if (req.method === "POST") {
          const u = req.form.username || "", pw = req.form.password || "";
          if (!accounts[u] || u === "carlos" || u === "administrator") { res.body = srv.page("Login", `<h1>Login</h1><p class="is-warning">Invalid username</p>${loginForm("/c1/login")}`, s); return; }
          if (accounts[u].pass !== pw) { res.body = srv.page("Login", `<h1>Login</h1><p class="is-warning">Incorrect password</p>${loginForm("/c1/login")}`, s); return; }
          s.user = u; res.status = 302; res.headers.Location = "/my-account"; return;
        }
        res.body = srv.page("Login", `<h1>Login</h1>${loginForm("/c1/login")}<p><small>Wordlists for Intruder are in the task hints.</small></p>`, s); return;
      }
      // ---- 2: method-based access control
      if (p === "/c2/admin") {
        if (s.user !== "administrator") { res.status = 401; res.body = srv.page("Admin", `<h1>Admin panel</h1><p>Admin interface only available if logged in as an administrator. Here's what the admin uses:</p><pre>POST /c2/admin-roles\nusername=carlos&action=upgrade</pre>`, s); return; }
      }
      if (p === "/c2/admin-roles") {
        if (!s.user) { res.status = 302; res.headers.Location = "/c1/login"; return; }
        const params = req.method === "POST" ? req.form : req.query;
        if (req.method === "POST" && s.user !== "administrator") { res.status = 401; res.body = '"Unauthorized"'; return; }
        if (!params.username || !params.action) { res.status = 400; res.body = '"Missing parameter"'; return; }
        if (!accounts[params.username]) { res.status = 400; res.body = '"Invalid username"'; return; }
        accounts[params.username].role = params.action === "upgrade" ? "ADMIN" : "NORMAL";
        if (params.username === s.user && params.action === "upgrade") srv.solve("c2", `Challenge 2 solved: ${s.user} promoted to ADMIN with ${req.method}`);
        res.status = 302; res.headers.Location = "/my-account"; return;
      }
      // ---- 3: password reset poisoning
      if (p === "/c3/forgot-password") {
        const tok = req.query["temp-forgot-password-token"];
        if (tok) {
          const u = resets[tok];
          if (!u) { res.status = 400; res.body = '"Invalid token"'; return; }
          if (req.method === "POST") { accounts[u].pass = req.form["new-password-1"] || ""; delete resets[tok]; res.body = srv.page("Reset", `<p>Password changed for ${esc(u)}. <a href="/c3/login">Log in</a></p>`, s); return; }
          res.body = srv.page("Reset", `<h1>Set a new password</h1><form action="/c3/forgot-password?temp-forgot-password-token=${tok}" method="POST"><label>New password</label><input type="text" name="new-password-1"><button type="submit">Submit</button></form>`, s); return;
        }
        if (req.method === "POST") {
          const u = req.form.username;
          const host = req.hv("host") || srv.HOST;
          if (accounts[u]) {
            const t = Web.rid(24); resets[t] = u;
            const link = `https://${host}/c3/forgot-password?temp-forgot-password-token=${t}`;
            if (u === "wiener") srv.sendEmail(`wiener@${W.EMAIL_HOST}`, "Account recovery", `Hello!\n\nPlease follow the link below to reset your password.\n\n${link}\n\nThanks,\nSupport team`);
            if (u === "carlos") setTimeout(() => { // carlos reads his mail and clicks the link
              try { const lu = new URL(link); W.victim.fetchReq({ method: "GET", url: lu.href, cross: true }); } catch {}
            }, 1500);
          }
          res.body = srv.page("Forgot password", "<p>Please check your email for a reset password link.</p>", s); return;
        }
        res.body = srv.page("Forgot password", `<h1>Forgot password</h1><form action="/c3/forgot-password" method="POST"><label>Username or email</label><input type="text" name="username"><button type="submit">Submit</button></form>`, s); return;
      }
      if (p === "/c3/login") {
        if (req.method === "POST") {
          const u = req.form.username, pw = req.form.password;
          if (accounts[u] && accounts[u].pass === pw) { s.user = u; s.viaReset = u === "carlos"; res.status = 302; res.headers.Location = "/my-account"; return; }
          res.body = srv.page("Login", `<p>Invalid username or password.</p>${loginForm("/c3/login")}`, s); return;
        }
        res.body = srv.page("Login", `<h1>Login</h1>${loginForm("/c3/login")}`, s); return;
      }
      res.status = 404; res.body = srv.page("Not found", "<p>Not Found</p>", s);
    },
    challenges: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    onIntruder(rows, srv) { if (rows.some((r) => r.p === victimUser && r.status === 200)) srv.data.enumerated = true; },
  });
  function loginForm(action) { return `<form class="login-form" method="POST" action="${action}"><label>Username</label><input type="text" name="username"><label>Password</label><input type="password" name="password"><button class="button" type="submit">Log in</button></form>`; }
  const S = W.srv.solved;

  Lab.start({
    brief: `
<p>Three challenges in the style of <b>PortSwigger's Web Security Academy</b>, built on Weeks 1–2: reading and editing raw HTTP, status codes and messages that leak, method tampering, and the Host header. You have a browser, <b>Burp Suite</b> (Proxy, Repeater, <b>Intruder</b>, Decoder), and an exploit server with an <b>email client</b> for wiener.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>PortSwigger lab it mirrors</th><th>Lecture idea</th></tr>
<tr><td>1</td><td>Username enumeration via different responses</td><td>Messages that leak (Week 2 status codes)</td></tr>
<tr><td>2</td><td>Method-based access control can be circumvented</td><td>Verb tampering: authorise the action, not the verb</td></tr>
<tr><td>3</td><td>Basic password reset poisoning</td><td>Host Header Injection</td></tr></table></div>
<p class="key"><b>Intruder in 20 seconds:</b> send a request to Intruder, select the value to attack, press <b>Add §</b>, paste a list into Payloads, optionally set Grep - Match, then <b>Start attack</b>. Look for the row that's different.</p>`,
    setup(api) { W.mount(api); },
    tasks: [
      { title: "1a · Find a valid username", detail: "Submit any login at /c1/login, send the POST to Intruder, attack the username with the list below and look for a different message (or length).", where: "Burp Intruder",
        hint: "Grep - Match “Invalid username”: the one row WITHOUT the match is a real account.", answer: "Usernames:\n" + USERS.join("\n"), check: () => S.c1 || W.srv.data.enumerated },
      { title: "1b · Find the password and log in as that user", detail: "Now fix the username and attack the password. The successful login answers <b>302</b>.", where: "Burp Intruder, then Browser",
        hint: "A 302 (highlighted dark) means success.", answer: "Passwords:\n" + PASSWORDS.join("\n"), check: () => S.c1 },
      { title: "2 · Promote yourself to admin by changing the method", detail: "Log in as wiener. /c2/admin shows the request the admin uses. The server only blocks <b>POST</b> for non-admins.", where: "Burp Repeater",
        hint: "Rewrite it as GET with the parameters in the query string, for your own username.", answer: "GET /c2/admin-roles?username=wiener&action=upgrade HTTP/2\nHost: (lab host)\nCookie: session=(your session)", check: () => S.c2 },
      { title: "3 · Poison carlos's password-reset link", detail: "Request a reset for wiener first and read the email. Then request one for <b>carlos</b> with the <code>Host</code> header set to your exploit server, so his link points to you. carlos clicks links in emails.", where: "Burp Repeater + Exploit server log",
        hint: "Repeater: POST /c3/forgot-password with Host: exploit-….exploit-server.net, body username=carlos. Then copy the token from the access log, open /c3/forgot-password?temp-forgot-password-token=TOKEN on the real site, set a password and log in as carlos at /c3/login.",
        answer: "POST /c3/forgot-password HTTP/2\nHost: (your exploit server host)\nContent-Type: application/x-www-form-urlencoded\n\nusername=carlos", check: () => S.c3 },
    ],
    doneText: "Leaky messages gave away a username, the HTTP method bypassed an access check, and a trusted Host header handed you carlos's reset token.",
    quiz: [
      { t: "match", q: "Match each part of an HTTP message to what it holds.", pairs: [["Start line", "Method, path and version (or status in a response)"], ["Headers", "Metadata: cookies, content type, caching"], ["Blank line", "Ends the headers"], ["Body", "Payload: form data, HTML, JSON"]], src: "Lecture 2, Anatomy of an HTTP message" },
      { t: "mcq", q: "Which methods are both safe and idempotent?", opts: ["GET, HEAD, OPTIONS", "POST, PATCH", "PUT, DELETE", "POST, PUT"], a: 0, src: "Lecture 2, HTTP methods table" },
      { t: "multi", q: "Which methods are idempotent but NOT safe? (Choose all that apply)", opts: ["PUT", "DELETE", "POST", "PATCH", "GET"], a: [0, 1], src: "Lecture 2, HTTP methods table" },
      { t: "mcq", q: "401 vs 403 — which is correct?", opts: ["401 = not authenticated (who are you?); 403 = authenticated but not allowed", "401 = forbidden; 403 = not found", "Both mean the password is wrong", "403 = server error"], a: 0, src: "Lecture 2, 401 vs 403" },
      { t: "short", q: "How did challenge 1 enumerate usernames, and how should a login page prevent it?", model: "The page answered “Invalid username” for unknown users but “Incorrect password” for real ones, so the different message (or length/status) revealed valid usernames. The fix is one generic error such as “Invalid username or password” for both cases.",
        keys: [["different", "message", "response"], ["generic", "same error", "same message"]], src: "Lecture 2, status codes can leak; Week 3" },
      { t: "mcq", q: "Challenge 2 worked because…", opts: ["The access rule checked only the literal POST method; the same action was accepted via GET", "The admin password was weak", "The cookie was not HttpOnly", "TLS was missing"], a: 0, why: "Fix: authorise the action, not the verb string.", src: "Lecture 2, Verb tampering" },
      { t: "fill", q: "Which header did challenge 3 abuse to poison the reset link?", a: ["Host", "host header"], src: "Lecture 2, Host Header Injection" },
      { t: "short", q: "What is the fix for password-reset poisoning?", model: "Never build security-sensitive URLs from client-controlled input such as the Host header; use a configured domain or validate Host against an allow-list of the site's real domains.",
        keys: [["host"], ["allow-list", "allow list", "allowlist", "configured", "validate"], ["never", "don't", "not"]], src: "Lecture 2, Host Header Injection" },
      { t: "mcq", q: "Why should secrets never be in a GET query string?", opts: ["URLs end up in browser history, server access logs and proxy logs", "GET can't carry more than 10 characters", "GET is always unencrypted even over HTTPS", "Browsers block GET with secrets"], a: 0, src: "Lecture 2, HTTP methods" },
      { t: "match", q: "Match the SameSite value to its behaviour.", pairs: [["Strict", "Never sent on cross-site requests, even a clicked link"], ["Lax", "Only on safe top-level navigation; the modern default"], ["None", "Sent on every cross-site request; requires Secure"]], src: "Lecture 2, SameSite table" },
      { t: "match", q: "Match the response header to what it defends against.", pairs: [["Strict-Transport-Security", "Downgrade / SSL stripping"], ["Content-Security-Policy", "XSS (restricts scripts)"], ["X-Frame-Options", "Clickjacking"], ["Referrer-Policy: no-referrer", "Leaking a token-bearing URL to third parties"], ["Cache-Control: no-store", "Sensitive pages left in the browser cache"]], src: "Lecture 2, Security-relevant headers" },
      { t: "order", q: "Order the steps before the browser talks to the application.", items: ["DNS resolution", "TCP handshake (SYN, SYN-ACK, ACK)", "TLS handshake", "HTTP request/response"], src: "Lecture 1, How a browser and a server connect" },
      { t: "mcq", q: "Which OWASP Top 10 2021 category is #1?", opts: ["A01 Broken Access Control", "A03 Injection", "A02 Cryptographic Failures", "A10 SSRF"], a: 0, src: "Lecture 1, OWASP Top 10" },
      { t: "short", q: "What is “Responsible / Coordinated Disclosure”?", model: "Reporting a real vulnerability privately to the system's owner first and giving them a fair window (commonly about 90 days) to fix it before any public disclosure.",
        keys: [["private", "privately", "owner"], ["90", "window", "time to fix"], ["before", "public"]], src: "Lecture 1, Legal and ethical responsibility" },
    ],
  });
})();
