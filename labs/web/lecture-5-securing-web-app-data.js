// Web Applications Security · Week 5 — Securing Web Application Data, PortSwigger style.
(() => {
  const { esc, b64, md5 } = Web;
  const PASSWORDS = ["123456", "password", "qwerty", "letmein", "monkey", "dragon", "baseball", "football", "shadow", "master", "michael", "superman", "trustno1", "batman", "sunshine", "princess", "starwars", "whatever", "freedom", "hello", "charlie", "donald", "computer", "summer", "iloveyou", "welcome", "ashley", "bailey", "access", "mustang"];
  const pass = { wiener: "peter", carlos: PASSWORDS[4 + Math.floor(Math.random() * 25)] };
  const DBPASS = Web.rid(20);
  const NID = String(19900000000 + Math.floor(Math.random() * 9999999));

  const W = Web.lab({
    siteName: "Data Playground — Week 5",
    email: false,
    handle(req, res, srv) {
      const s = srv.session(req, res);
      const p = req.path;
      const submit = (c) => `<form method="POST" action="/c${c}/submit"><label>Answer</label><input type="text" name="answer"><button type="submit">Submit solution</button></form>`;
      if (p === "/") { res.body = srv.page("Home", `<h1>Week 5 — protecting data</h1><ul><li><a href="/c1/login">1. Login with “Stay logged in”</a></li><li>2. Somewhere on this site a developer left a backup (try the usual files robots crawl)</li><li><a href="/c3/profile">3. Profile API with an “encrypted” national ID</a></li></ul>`, s); return; }
      // ---- 1: stay-logged-in cookie = base64(user + ":" + md5(password))
      if (p === "/c1/login") {
        if (req.method === "POST") {
          const u = req.form.username;
          if (pass[u] && pass[u] === req.form.password) {
            s.user = u;
            if (req.form["stay-logged-in"]) res.setCookies.push(`stay-logged-in=${b64.enc(u + ":" + md5(pass[u]))}; Expires=Wed, 01 Jan 3000 01:00:00 UTC`);
            res.status = 302; res.headers.Location = "/c1/my-account?id=" + u; return;
          }
          res.body = srv.page("Login", "<p>Invalid username or password.</p>", s); return;
        }
        res.body = srv.page("Login", `<h1>Login</h1><form method="POST" action="/c1/login"><label>Username</label><input type="text" name="username"><label>Password</label><input type="password" name="password"><label><input type="checkbox" name="stay-logged-in" value="on"> Stay logged in</label><button type="submit">Log in</button></form>`, s); return;
      }
      if (p === "/c1/my-account") {
        let user = s.user;
        const st = req.cookies["stay-logged-in"];
        if (st) { try { const [u, hsh] = b64.dec(st).split(":"); if (pass[u] && md5(pass[u]) === hsh) user = u; } catch {} }
        if (!user || (req.query.id && req.query.id !== user)) { res.status = 302; res.headers.Location = "/c1/login"; return; }
        if (user === "carlos" && req.via !== "intruder") srv.solve("c1", "Challenge 1 solved: you rebuilt carlos's stay-logged-in cookie");
        res.body = srv.page("My account", `<h1>My Account</h1><p>Your username is: <b>${esc(user)}</b></p>`, s); return;
      }
      // ---- 2: backup file with a hard-coded secret
      if (p === "/robots.txt") { res.type = "text/plain"; res.body = "User-agent: *\nDisallow: /backup"; return; }
      if (p === "/backup" || p === "/backup/") { res.body = srv.page("Index of /backup", `<h1>Index of /backup</h1><p><a href="/backup/ProductTemplate.java.bak">ProductTemplate.java.bak</a></p>`, s); return; }
      if (p === "/backup/ProductTemplate.java.bak") {
        res.type = "text/plain";
        res.body = `package data.productcatalog;\n\nimport common.db.JdbcConnectionBuilder;\n\npublic class ProductTemplate implements Serializable {\n    static final long serialVersionUID = 1L;\n    private final String id;\n\n    private void readObject(ObjectInputStream inputStream) throws IOException, ClassNotFoundException {\n        ConnectionBuilder connectionBuilder = ConnectionBuilder.from(\n                "org.postgresql.Driver",\n                "postgresql",\n                "localhost",\n                5432,\n                "postgres",\n                "postgres",\n                "${DBPASS}"\n        ).withAutoCommit();\n    }\n}`;
        return;
      }
      if (p === "/c2/submit" || p === "/submit") {
        if (req.method === "POST") { const ok = (req.form.answer || "").trim() === DBPASS; if (ok) srv.solve("c2", "Challenge 2 solved: hard-coded database password found in a backup file"); res.body = srv.page("Solution", `<p>${ok ? "Correct!" : "Incorrect answer."}</p>`, s); return; }
        res.body = srv.page("Submit", `<h1>Submit the database password</h1>${submit(2)}`, s); return;
      }
      // ---- 3: Base64 is encoding, not encryption
      if (p === "/c3/profile") {
        res.body = srv.page("Profile", `<h1>Your profile</h1><p>Our app loads your data from <a href="/c3/api/user">/c3/api/user</a>. National ID numbers are stored “encrypted”.</p>${submit(3)}`, s); return;
      }
      if (p === "/c3/api/user") { res.type = "application/json; charset=utf-8"; res.body = JSON.stringify({ username: "wiener", email: "wiener@normal-user.net", nationalId: b64.enc(NID), note: "nationalId is encrypted at rest" }, null, 2); return; }
      if (p === "/c3/submit") {
        const ok = (req.form.answer || "").trim() === NID;
        if (ok) srv.solve("c3", "Challenge 3 solved: Base64 is encoding, not encryption");
        res.body = srv.page("Solution", `<p>${ok ? "Correct! Anyone can reverse Base64 — it provides no confidentiality." : "Incorrect answer."}</p>`, s); return;
      }
      res.status = 404; res.body = srv.page("Not found", "<p>Not Found</p>", s);
    },
    challenges: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    exploitServer: false,
    onDecode(kind, input, out, srv) { if (kind === "b64d" && /^wiener:[0-9a-f]{32}$/.test(out.trim())) srv.data.decoded = true; },
  });
  const S = W.srv.solved;

  Lab.start({
    brief: `
<p>Three data-protection challenges in the style of <b>PortSwigger's Web Security Academy</b>, built on Week 5: hashing done wrong, a secret that should never have been in the code, and encoding mistaken for encryption. Your account: <code>wiener / peter</code>.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>PortSwigger lab / idea</th><th>Week 5 lesson</th></tr>
<tr><td>1</td><td>Brute-forcing a stay-logged-in cookie</td><td>Unsalted fast hash (MD5) + Base64 ≠ protection</td></tr>
<tr><td>2</td><td>Source code disclosure via backup files</td><td>Never hard-code keys/passwords</td></tr>
<tr><td>3</td><td>“Encrypted” field that's only Base64</td><td>Encoding vs encryption vs hashing</td></tr></table></div>
<p class="key">Intruder can transform each payload: <b>Hash: MD5</b> → <b>Add prefix</b> → <b>Encode: Base64</b>, in that order — exactly what challenge 1 needs.</p>`,
    setup(api) { W.mount(api); },
    tasks: [
      { title: "1a · Decode your own stay-logged-in cookie", detail: "Log in at /c1/login as wiener with <b>Stay logged in</b> ticked. Copy the cookie (DevTools › Cookies) into Burp › Decoder and decode it.", where: "Browser + Decoder",
        hint: "Decode Base64 gives wiener:&lt;32 hex chars&gt;. Hash “peter” with MD5 in Decoder and compare.", check: () => W.srv.data.decoded },
      { title: "1b · Brute-force carlos's cookie and use it", detail: "Attack <code>GET /c1/my-account?id=carlos</code> with the cookie as the payload position: MD5 the password, prefix <code>carlos:</code>, Base64-encode. Then put the winning value in your browser's cookie.", where: "Burp Intruder + DevTools",
        hint: "Remove the session cookie from the template, keep only stay-logged-in=§…§. Grep for “Your username is”.", answer: "GET /c1/my-account?id=carlos HTTP/2\nHost: (lab host)\nCookie: stay-logged-in=§x§\n\nPayloads:\n" + PASSWORDS.join("\n") + "\n\nProcessing: Hash MD5 · prefix carlos: · Encode Base64", check: () => S.c1 },
      { title: "2 · Find the hard-coded database password", detail: "Developers left something behind. Robots files are a good place to start. Submit the password at <b>/c2/submit</b>.", where: "Browser",
        hint: "/robots.txt → /backup → the .bak file. The last string in the connection builder is the password.", check: () => S.c2 },
      { title: "3 · Read the “encrypted” national ID", detail: "Open /c3/api/user. Is the nationalId really encrypted? Submit the real number on /c3/profile.", where: "Browser + Decoder",
        hint: "No key is needed to reverse it.", check: () => S.c3 },
    ],
    doneText: "A fast unsalted hash wrapped in Base64, a password in a backup file, and Base64 sold as encryption: three A02 Cryptographic Failures.",
    quiz: [
      { t: "match", q: "Match each technique to its properties.", pairs: [["Encoding (Base64)", "Reversible by anyone, no key"], ["Encryption", "Reversible only with the key"], ["Hashing", "One-way, no key"]], src: "Lecture 5, Encoding vs Encryption vs Hashing" },
      { t: "tf", q: "Storing a password as Base64 protects its confidentiality.", a: false, why: "Base64 is encoding: anyone can decode it. Challenge 3 proved it.", src: "Lecture 5" },
      { t: "match", q: "Match each data classification level to an example.", pairs: [["Public", "Published prices"], ["Internal", "Internal documentation"], ["Confidential", "Business strategy"], ["Restricted", "National ID, health, card data"]], src: "Lecture 5, Data Classification" },
      { t: "mcq", q: "Which level requires encryption at rest AND in transit, strict access logging, and often a regulatory obligation?", opts: ["Restricted", "Confidential", "Internal", "Public"], a: 0, src: "Lecture 5, classification table" },
      { t: "multi", q: "Which are principles of key management? (Choose all that apply)", opts: ["Never store the key with the data it protects", "Rotate keys on a schedule", "Never hard-code keys in source code or committed config", "Use the same key everywhere for simplicity", "Email keys to developers"], a: [0, 1, 2], src: "Lecture 5, Principles of Key Management" },
      { t: "mcq", q: "How does TLS combine symmetric and asymmetric cryptography?", opts: ["Asymmetric only during the handshake (authentication, key agreement), then fast symmetric encryption for the data", "Symmetric for the handshake, asymmetric for the data", "Only asymmetric throughout", "Only symmetric throughout"], a: 0, src: "Lecture 5, Symmetric and Asymmetric Encryption in Practice" },
      { t: "short", q: "What is tokenization, and why does it reduce the damage of a breach?", model: "Replacing a sensitive value (e.g. a card number) with a random token that has no mathematical relationship to it; the real mapping is kept in a separate, tightly controlled vault. A breached app database yields only meaningless tokens.",
        keys: [["random", "token"], ["vault", "separate"], ["no mathematical", "no relationship", "meaningless"]], src: "Lecture 5, Tokenization" },
      { t: "mcq", q: "What is data minimization?", opts: ["Collect only what a feature needs and delete it when its purpose is done", "Compressing data before storage", "Encrypting only small fields", "Keeping data forever but encrypted"], a: 0, src: "Lecture 5, Data Minimization" },
      { t: "multi", q: "Which are examples of OWASP A02:2021 Cryptographic Failures? (Choose all that apply)", opts: ["Sending sensitive data in plain text instead of TLS", "Using MD5 or DES", "Sensitive data unencrypted at rest", "Hard-coded or never-rotated keys", "Predictable random numbers where secure randomness is needed", "A missing CSRF token"], a: [0, 1, 2, 3, 4], src: "Lecture 5, Cryptographic Failures" },
      { t: "short", q: "Why could you brute-force carlos's stay-logged-in cookie so quickly (challenge 1)?", model: "The cookie is just Base64 (reversible) of username:MD5(password). MD5 is fast and unsalted, so you can hash a wordlist and rebuild the cookie offline. A random, server-stored token (or a salted, slow hash) would prevent it.",
        keys: [["md5", "fast"], ["salt", "unsalted"], ["base64", "encoding", "reversible"]], src: "Lab challenge 1; Lectures 3 and 5" },
      { t: "fill", q: "Data moving between browser and server is data in ______; data in a database or backup is data at ______.", a: [/transit.*rest/i], ph: "transit / rest", src: "Lecture 5, Data in Transit and at Rest" },
    ],
  });
})();
