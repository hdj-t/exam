// Web Applications Security · Week 3 — Authentication and Session Management, PortSwigger style.
(() => {
  const { esc, b64, b64url } = Web;
  const PASSWORDS = ["123456", "password", "qwerty", "letmein", "monkey", "dragon", "baseball", "football", "shadow", "master", "michael", "superman", "trustno1", "batman", "sunshine", "princess", "starwars", "whatever", "freedom", "hello", "charlie", "donald", "zaq1zaq1", "computer", "summer", "iloveyou", "welcome", "ashley", "bailey", "access"];
  const c2pass = PASSWORDS[5 + Math.floor(Math.random() * 20)];
  const users = { wiener: "peter", carlos: "montoya" };
  const fix = {}; // challenge 3: session id → user (never regenerated at login)
  const SECRET = Web.rid(24);
  const sign = (h, p) => Web.md5(SECRET + h + "." + p).slice(0, 43);
  const jwt = (payload) => { const h = b64url(JSON.stringify({ kid: "k1", alg: "HS256" })), p = b64url(JSON.stringify(payload)); return `${h}.${p}.${sign(h, p)}`; };
  const accounts4 = { wiener: true, carlos: true, administrator: true };

  const W = Web.lab({
    siteName: "Auth Playground — Week 3",
    email: false,
    handle(req, res, srv) {
      const s = srv.session(req, res);
      const p = req.path;
      const form = (action, extra = "") => `<form class="login-form" method="POST" action="${action}">${extra}<label>Username</label><input type="text" name="username"><label>Password</label><input type="password" name="password"><button class="button" type="submit">Log in</button></form>`;
      if (p === "/") { res.body = srv.page("Home", `<h1>Week 3 — four login systems</h1><ul><li><a href="/c1/login">1. Login with 2FA</a> (you know carlos's password: <b>montoya</b>)</li><li><a href="/c2/login">2. Login without rate limiting</a></li><li><a href="/c3/login">3. Login that keeps your session ID</a></li><li><a href="/c4/login">4. Login with JWT</a></li></ul>`, s); return; }

      // ---- 1: 2FA simple bypass
      if (p === "/c1/login") {
        if (req.method === "POST") {
          const u = req.form.username;
          if (users[u] && users[u] === req.form.password) { s.c1 = { user: u, mfa: false }; res.status = 302; res.headers.Location = "/c1/login2"; return; }
          res.body = srv.page("Login", `<p>Invalid username or password.</p>${form("/c1/login")}`, s); return;
        }
        res.body = srv.page("Login", `<h1>Login</h1>${form("/c1/login")}`, s); return;
      }
      if (p === "/c1/login2") {
        if (!s.c1) { res.status = 302; res.headers.Location = "/c1/login"; return; }
        if (req.method === "POST") { res.body = srv.page("2FA", `<p>Incorrect security code.</p>`, s); return; }
        res.body = srv.page("2FA", `<h1>Please enter your 4-digit security code</h1><p>A code was sent to ${esc(s.c1.user)}'s email address.</p><form method="POST" action="/c1/login2"><input type="text" name="mfa-code"><button type="submit">Login</button></form>`, s); return;
      }
      if (p === "/c1/my-account") {
        if (!s.c1) { res.status = 302; res.headers.Location = "/c1/login"; return; }
        if (s.c1.user === "carlos") srv.solve("c1", "Challenge 1 solved: 2FA skipped — the session was already logged in after step one");
        res.body = srv.page("My account", `<h1>My Account</h1><p>Your username is: <b>${esc(s.c1.user)}</b></p>`, s); return;
      }

      // ---- 2: brute force (no lockout, no rate limit)
      if (p === "/c2/login") {
        if (req.method === "POST") {
          const ok = req.form.username === "carlos" && req.form.password === c2pass;
          if (ok) { s.c2 = "carlos"; srv.data.c2found = true; res.status = 302; res.headers.Location = "/c2/my-account"; return; }
          res.body = srv.page("Login", `<p>Invalid username or password.</p>${form("/c2/login")}`, s); return;
        }
        res.body = srv.page("Login", `<h1>Login</h1>${form("/c2/login")}`, s); return;
      }
      if (p === "/c2/my-account") {
        if (s.c2 !== "carlos") { res.status = 302; res.headers.Location = "/c2/login"; return; }
        srv.solve("c2", "Challenge 2 solved: carlos's password brute-forced");
        res.body = srv.page("My account", `<p>Your username is: <b>carlos</b></p>`, s); return;
      }

      // ---- 3: session fixation (sid accepted from the URL, not regenerated at login)
      if (p.startsWith("/c3/")) {
        let sid = req.query.sid || req.cookies.sid3;
        if (!sid) sid = Web.rid(20);
        if (!req.cookies.sid3 || req.cookies.sid3 !== sid) res.setCookies.push(`sid3=${sid}; Secure; HttpOnly; SameSite=None`);
        if (p === "/c3/login") {
          if (req.method === "POST") {
            const u = req.form.username;
            if (users[u] && users[u] === req.form.password) { fix[sid] = u; res.status = 302; res.headers.Location = "/c3/my-account"; return; } // same sid kept!
            res.body = srv.page("Login", `<p>Invalid username or password.</p>`, s); return;
          }
          res.body = srv.page("Login", `<h1>Login</h1><p><small>Session: ${sid}</small></p>${form("/c3/login")}`, s); return;
        }
        if (p === "/c3/my-account") {
          const u = fix[sid];
          if (!u) { res.status = 302; res.headers.Location = "/c3/login"; return; }
          if (u === "carlos" && req.from === "you") srv.solve("c3", "Challenge 3 solved: carlos logged in on a session ID you chose");
          res.body = srv.page("My account", `<p>Your username is: <b>${esc(u)}</b></p>`, s); return;
        }
      }

      // ---- 4: JWT with unverified signature
      if (p === "/c4/login") {
        if (req.method === "POST") {
          if (req.form.username === "wiener" && req.form.password === "peter") { res.setCookies.push(`jwt=${jwt({ iss: "portswigger", exp: 1893456000, sub: "wiener" })}; Secure; HttpOnly; SameSite=None`); res.status = 302; res.headers.Location = "/c4/my-account"; return; }
          res.body = srv.page("Login", `<p>Invalid username or password.</p>`, s); return;
        }
        res.body = srv.page("Login", `<h1>Login</h1>${form("/c4/login")}`, s); return;
      }
      if (p.startsWith("/c4/")) {
        let who = null;
        try { const [, pl] = (req.cookies.jwt || "").split("."); who = JSON.parse(b64.dec(pl)).sub; } catch {} // BUG: signature never checked
        if (!who) { res.status = 302; res.headers.Location = "/c4/login"; return; }
        if (p === "/c4/my-account") { res.body = srv.page("My account", `<p>Your username is: <b>${esc(who)}</b></p>${who === "administrator" ? `<p><a href="/c4/admin">Admin panel</a></p>` : ""}`, s); return; }
        if (p === "/c4/admin") {
          if (who !== "administrator") { res.status = 401; res.body = srv.page("Admin", "<p>Admin interface only available if logged in as an administrator</p>", s); return; }
          if (req.query.delete) { delete accounts4[req.query.delete]; if (req.query.delete === "carlos") srv.solve("c4", "Challenge 4 solved: you forged a JWT and deleted carlos"); res.status = 302; res.headers.Location = "/c4/admin"; return; }
          res.body = srv.page("Admin", `<h1>Users</h1>${Object.keys(accounts4).map((u) => `<p>${u} ${u !== "administrator" ? `<a href="/c4/admin?delete=${u}">Delete</a>` : ""}</p>`).join("")}`, s); return;
        }
      }
      res.status = 404; res.body = srv.page("Not found", "<p>Not Found</p>", s);
    },
    onView(who, url, res, srv) {
      // the victim (carlos) logs in whenever he lands on the challenge-3 login page
      if (who === "victim" && /\/c3\/login/.test(url) && !/my-account/.test(url)) {
        setTimeout(() => W.victim.fetchReq({ method: "POST", url: `https://${srv.HOST}/c3/login`, body: "username=carlos&password=montoya", cross: false }), 300);
      }
    },
    challenges: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }],
  });
  const S = W.srv.solved;

  Lab.start({
    brief: `
<p>Four authentication and session challenges in the style of <b>PortSwigger's Web Security Academy</b>, built on Week 3. Your account: <code>wiener / peter</code>.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>PortSwigger lab / idea</th><th>Week 3 lesson</th></tr>
<tr><td>1</td><td>2FA simple bypass</td><td>MFA must actually gate the session</td></tr>
<tr><td>2</td><td>Password brute force (no rate limit)</td><td>Lockout / rate limiting, MFA</td></tr>
<tr><td>3</td><td>Session fixation</td><td>Regenerate the session ID at login</td></tr>
<tr><td>4</td><td>JWT authentication bypass via unverified signature</td><td>The signature is what makes a JWT trustworthy</td></tr></table></div>
<p class="key"><b>JWT refresher:</b> <code>header.payload.signature</code>, each part base64url-encoded. Burp › Decoder has <b>Decode JWT</b> and <b>Encode Base64URL</b>.</p>`,
    setup(api) { W.mount(api); },
    tasks: [
      { title: "1 · Bypass 2FA and open carlos's account", detail: "You know carlos's password (montoya) but not his 2FA code.", where: "Browser",
        hint: "After the first step, is the session already logged in? Try going straight to the account page.", answer: "Log in as carlos/montoya at /c1/login → when asked for the code, open /c1/my-account directly", check: () => S.c1 },
      { title: "2 · Brute-force carlos's password", detail: "/c2/login has no lockout and no rate limit. Use Intruder with the candidate list.", where: "Burp Intruder",
        hint: "Send a failed login for username carlos to Intruder, mark the password, paste the list, look for status 302. Then log in with it and open /c2/my-account.", answer: "Candidate passwords:\n" + PASSWORDS.join("\n"), check: () => S.c2 },
      { title: "3 · Fix carlos's session ID, then ride it", detail: "/c3 accepts a session ID from the URL (<code>?sid=…</code>) and keeps it after login. carlos logs in whenever he lands on the /c3 login page.", where: "Exploit server + DevTools",
        hint: "Choose an ID (e.g. attacker123), deliver an exploit that sends carlos to /c3/login?sid=attacker123, then set your own sid3 cookie to attacker123 and open /c3/my-account.",
        answer: `<script>document.location = "https://${W.HOST}/c3/login?sid=attacker123";</script>\n\nThen: Browser › open https://${W.HOST}/c3/login?sid=attacker123 → /c3/my-account`, check: () => S.c3 },
      { title: "4 · Forge a JWT and delete carlos", detail: "Log in at /c4 as wiener. The server reads <code>sub</code> from the token but never checks the signature.", where: "Burp Decoder + DevTools cookies",
        hint: "Decode the jwt cookie, change \"sub\":\"wiener\" to \"administrator\", Base64URL-encode the new payload, put it back between the dots, then open /c4/admin and delete carlos.",
        answer: "payload: {\"iss\":\"portswigger\",\"exp\":1893456000,\"sub\":\"administrator\"}\n→ Encode Base64URL → replace the middle part of the jwt cookie\n→ /c4/admin → Delete carlos", check: () => S.c4 },
    ],
    doneText: "2FA that didn't gate the session, an unthrottled login, a session ID that survived login, and an unverified JWT: four classic Week 3 failures.",
    quiz: [
      { t: "match", q: "Match each authentication factor to an example.", pairs: [["Something you know", "Password or PIN"], ["Something you have", "OTP app or hardware key"], ["Something you are", "Fingerprint"]], src: "Lecture 3, Authentication factors" },
      { t: "tf", q: "A password plus a security question is multi-factor authentication.", a: false, why: "Both are “something you know” — one factor category. MFA needs at least two different categories.", src: "Lecture 3, MFA" },
      { t: "order", q: "Rank OWASP's acceptable password hashing algorithms, first choice first.", items: ["Argon2id", "scrypt", "bcrypt (legacy)", "PBKDF2 (FIPS-140)"], src: "Lecture 3, Password storage" },
      { t: "mcq", q: "Why are plain MD5 or SHA-256 unacceptable for passwords?", opts: ["They are designed to be fast, so attackers can test millions of guesses per second", "They are reversible", "They need a key", "They produce different hashes for the same password"], a: 0, src: "Lecture 3, Password storage" },
      { t: "mcq", q: "What does a per-user salt defeat?", opts: ["Precomputed rainbow-table attacks (identical passwords no longer share a hash)", "Phishing", "Session fixation", "CSRF"], a: 0, src: "Lecture 3, Password storage" },
      { t: "match", q: "Match each attack to its primary mitigation.", pairs: [["Brute force", "Account lockout / rate limiting"], ["Credential stuffing", "MFA and breached-password checks"], ["Session hijacking", "HttpOnly + Secure cookies, HTTPS"], ["Session fixation", "Regenerate the session ID at login"]], src: "Lecture 3, Common attacks table" },
      { t: "short", q: "Explain session fixation and its fix (challenge 3).", model: "The attacker gets the victim to log in using a session ID the attacker already knows; if the server keeps that same ID after login, the attacker's copy is now authenticated as the victim. Fix: issue a brand-new session ID at every privilege change, especially login.",
        keys: [["session id", "session"], ["known", "attacker", "chose", "already"], ["regenerat", "new session", "brand-new"]], src: "Lecture 3, Session Fixation" },
      { t: "mcq", q: "Why did challenge 1's 2FA fail?", opts: ["The session counted as logged in after the password step, so the account page didn't check the second factor", "The code was only 4 digits", "SMS was intercepted", "The password was weak"], a: 0, src: "Lab challenge 1; Lecture 3 (MFA must be enforced)" },
      { t: "match", q: "Match the JWT part to its content.", pairs: [["Header", "Signing algorithm"], ["Payload", "Claims such as sub and exp"], ["Signature", "Proof the token wasn't altered, made with a server secret"]], src: "Lecture 3, Tokens" },
      { t: "mcq", q: "Compared with a server-side session, what is a JWT's main risk?", opts: ["A stolen token stays valid until it expires, because there's no session entry to revoke", "It can't carry claims", "It requires cookies to be disabled", "It's always unsigned"], a: 0, src: "Lecture 3, Modern authentication" },
      { t: "fill", q: "Authentication failure → HTTP 401. Authorization failure (known user, not allowed) → HTTP ___.", a: ["403"], src: "Lecture 3, AuthN vs AuthZ; Lecture 2" },
      { t: "mcq", q: "What problem do OAuth 2.0 / SSO solve?", opts: ["Authenticate once with a trusted identity provider and reuse that identity across apps, so each app needn't store passwords", "Encrypting data at rest", "Preventing XSS", "Load balancing"], a: 0, src: "Lecture 3, OAuth and SSO" },
    ],
  });
})();
