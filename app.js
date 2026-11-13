// Home page: exam countdowns, course chips, "exam only" filter, continue reading,
// and full-text search over every page (data/search.json, loaded on first use).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---- countdowns; finished exams sink to the bottom
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = (iso) => Math.round((new Date(iso + "T00:00:00") - today) / 864e5);
  const lists = $("#lists");
  let next = null;
  for (const sec of $$(".course")) {
    const d = days(sec.dataset.exam);
    const cd = $(".countdown", sec);
    const chip = $(`.chip[data-course="${sec.id}"]`);
    if (d < 0) {
      cd.textContent = "· done";
      sec.classList.add("is-past");
      chip.classList.add("is-past");
      lists.append(sec);
      $(".chips").append(chip);
    } else {
      cd.textContent = d === 0 ? "TODAY" : d === 1 ? "tomorrow" : `in ${d} days`;
      if (d <= 3) cd.classList.add("is-soon");
      if (!next) { next = { sec, d }; chip.classList.add("is-next"); }
    }
  }
  if (next) {
    const n = $("#next");
    const when = next.d === 0 ? "today" : next.d === 1 ? "tomorrow" : `in ${next.d} days`;
    n.innerHTML = `Next exam: <b>${esc($("h2", next.sec).textContent)}</b> ${when}`;
    n.hidden = false;
  }

  // ---- highlight the chip for the course on screen
  const chips = new Map($$(".chip").map((c) => [c.dataset.course, c]));
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      chips.forEach((c) => c.classList.remove("is-here"));
      const c = chips.get(e.target.id);
      c.classList.add("is-here");
      // scroll only the chip row sideways: scrollIntoView would also move the
      // page and cut the user's swipe short on phones
      const row = c.parentElement;
      const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (cr.left < rr.left || cr.right > rr.right) row.scrollLeft += cr.left - rr.left - 8;
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  $$(".course").forEach((s) => io.observe(s));

  // ---- your progress: lectures read, summaries opened, labs finished, best mock scores, cards learned
  const json = (k) => { try { return JSON.parse(store.get(k)); } catch { return null; } };
  for (const sec of $$(".course")) {
    let lec = 0, lecRead = 0, any = false;
    for (const li of $$(".doc", sec)) {
      const id = li.dataset.doc, pages = +li.dataset.pages;
      const seen = +store.get("read:" + id) || 0;
      const read = seen >= Math.max(1, pages - 1); // last page, or the one before (short last slides)
      if (li.dataset.kind === "lecture") { lec++; lecRead += read; }
      if (seen) any = true;
      li.classList.toggle("is-read", read);
      $(".num", li)?.setAttribute("title", read ? "Read" : seen ? `Read up to page ${seen}` : "");
      const sum = $(".doc-sum", li);
      if (sum && store.get("sum:" + id)) { sum.classList.add("is-done"); any = true; }
      const lab = $(".doc-run", li);
      if (lab && json("lab:" + id + ":done")) { lab.classList.add("is-done"); $("small", lab).textContent = "DONE"; any = true; }
      const mock = $(".doc-mock", li), best = json("mock:" + id + ":best");
      if (mock && best != null) { mock.classList.add("is-done"); $("small", mock).textContent = best + "%"; any = true; }
    }
    const mid = json(`mock:${sec.id}/midterm:best`);
    const cards = Object.keys(json("cards:" + sec.id) || {}).length, cardsN = +sec.dataset.cards;
    if (mid != null || cards) any = true;
    if (!any) continue;
    const bits = [`<b>${lecRead}/${lec}</b> lectures read`];
    if (mid != null) bits.push(`midterm best <b>${mid}%</b>`);
    if (cardsN) bits.push(`<b>${cards}/${cardsN}</b> cards`);
    const p = $(".mine", sec);
    p.innerHTML = `<span class="mine-k">You</span> ${bits.join(" · ")}`;
    p.hidden = false;
  }

  // ---- save a whole course for offline use (Cache API; sw.js serves it when there's no network)
  if ("caches" in window && "serviceWorker" in navigator && isSecureContext) {
    const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB";
    let list = null;
    const getList = () => (list ??= fetch("data/offline.json").then((r) => r.json()));
    const state = (btn, sec) => {
      const saved = store.get("offline:" + btn.dataset.course);
      getList().then((l) => {
        const info = l[btn.dataset.course];
        btn.textContent = saved ? "✓ Saved offline" : "⤓ Save offline";
        btn.classList.toggle("is-saved", !!saved);
        $(".off-s", sec).textContent = saved ? `${new Date(+saved).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · tap to update` : `${mb(info.bytes)} · lectures, summaries, labs, exams`;
        $(".off", sec).hidden = false;
      }).catch(() => {});
    };
    for (const btn of $$(".off-btn")) {
      const sec = btn.closest(".course");
      state(btn, sec);
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        // sw.js is never cached, so this only succeeds with a real connection
        try { await fetch("sw.js?probe=" + Date.now(), { cache: "no-store" }); }
        catch { $(".off-s", sec).textContent = "No connection. Try again when you're online."; return; }
        btn.disabled = true;
        const urls = [...(await getList())[btn.dataset.course].urls], total = urls.length;
        const cache = await caches.open("exam-data");
        let done = 0, failed = 0;
        const next = async () => {
          while (urls.length) {
            const u = urls.shift();
            try { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw 0; await cache.put(u, r); } catch { failed++; }
            done++;
            btn.textContent = `Saving ${Math.round((done / (done + urls.length)) * 100)}%`;
          }
        };
        await Promise.all([next(), next(), next(), next()]);
        btn.disabled = false;
        if (failed) {
          btn.textContent = "⤓ Save offline";
          $(".off-s", sec).textContent = `${failed} of ${total} files failed. Tap to try again.`;
          return;
        }
        store.set("offline:" + btn.dataset.course, String(Date.now()));
        state(btn, sec);
      });
    }
  }

  // ---- exam-only filter (remembered)
  const only = $("#only");
  const setOnly = (on) => {
    document.body.classList.toggle("only-exam", on);
    only.setAttribute("aria-pressed", on);
    store.set("exam-only", on ? "1" : "0");
  };
  only.addEventListener("click", () => setOnly(only.getAttribute("aria-pressed") !== "true"));
  setOnly(store.get("exam-only") === "1");

  // ---- continue reading
  try {
    const last = JSON.parse(store.get("last-read") || "null");
    if (last?.href) {
      const a = $("#continue");
      a.href = `${last.href}#p${last.page}`;
      a.innerHTML = `<small>Continue reading</small><b>${esc(last.title)}</b><span>p. ${last.page}/${last.pages} →</span>`;
      a.hidden = false;
    }
  } catch {}

  // ---- search
  const q = $("#q"), qx = $("#qx"), results = $("#results");
  let index = null, loading = null;
  const load = () => (loading ??= fetch("data/search.json").then((r) => r.json()).then((d) => {
    index = d.map((doc) => ({ ...doc, tl: doc.t.toLowerCase(), pl: doc.p.map((p) => p.toLowerCase()) }));
  }));
  q.addEventListener("focus", load, { once: true });

  const snippet = (text, lower, terms) => {
    const at = Math.max(0, lower.indexOf(terms[0]));
    let s = Math.max(0, at - 60), e = Math.min(text.length, at + 120);
    let out = (s ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "");
    out = esc(out);
    const re = new RegExp(`(${terms.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return out.replace(re, "<mark>$1</mark>");
  };

  function find(raw) {
    const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return null;
    const out = [];
    for (const doc of index) {
      const titleHit = terms.every((t) => doc.tl.includes(t));
      const pages = [];
      doc.pl.forEach((p, i) => {
        if (terms.every((t) => p.includes(t) || doc.tl.includes(t)) && terms.some((t) => p.includes(t))) pages.push(i);
      });
      if (!titleHit && !pages.length) continue;
      const count = pages.reduce((n, i) => n + doc.pl[i].split(terms[0]).length - 1, 0);
      out.push({ doc, titleHit, pages, score: (titleHit ? 1000 : 0) + count });
    }
    return { terms, out: out.sort((a, b) => b.score - a.score) };
  }

  function show(raw) {
    const r = find(raw);
    if (!r) return;
    const examOnly = document.body.classList.contains("only-exam");
    let list = r.out;
    if (examOnly) {
      const ok = new Set($$(".doc:not(.is-out) .doc-a").map((a) => a.getAttribute("href").replace(/^read\/|\.html$/g, "")));
      list = list.filter((x) => ok.has(x.doc.id.replace(/^sum:/, "")));
    }
    const qs = encodeURIComponent(raw.trim());
    const nPages = list.reduce((n, x) => n + x.pages.length, 0);
    results.innerHTML = list.length
      ? `<p class="results-h">${list.length} file${list.length > 1 ? "s" : ""} · ${nPages} page${nPages === 1 ? "" : "s"}${examOnly ? " · exam only" : ""}</p><ol role="list">${list.slice(0, 40).map((x) => {
          const base = `${x.doc.u || `read/${x.doc.id}.html`}?q=${qs}&hits=${x.pages.map((i) => i + 1).join(",")}`;
          const [course, ...rest] = x.doc.t.split(" · ");
          const pages = x.pages.slice(0, 3).map((i) =>
            `<a class="hit-p" href="${base}#p${i + 1}"><i>p.${i + 1}</i>${snippet(x.doc.p[i], x.doc.pl[i], r.terms)}</a>`).join("");
          const more = x.pages.length > 3 ? `<span class="hit-more">+ ${x.pages.length - 3} more page${x.pages.length - 3 > 1 ? "s" : ""}</span>` : "";
          return `<li class="hit"><a class="hit-h" href="${base}${x.pages.length ? "#p" + (x.pages[0] + 1) : ""}"><small>${esc(course)}</small><b>${esc(rest.join(" · "))}</b></a>${pages}${more}</li>`;
        }).join("")}</ol>`
      : `<p class="empty">Nothing found for “${esc(raw.trim())}”. Try fewer or shorter words.</p>`;
  }

  let timer;
  async function onInput() {
    const v = q.value;
    qx.hidden = !v;
    const on = v.trim().length >= 2;
    results.hidden = !on;
    lists.hidden = on;
    history.replaceState(null, "", on ? `?q=${encodeURIComponent(v.trim())}` : location.pathname);
    if (!on) return;
    clearTimeout(timer);
    timer = setTimeout(async () => { await load(); show(v); }, 120);
  }
  q.addEventListener("input", onInput);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") q.blur(); if (e.key === "Escape") { q.value = ""; onInput(); } });
  qx.addEventListener("click", () => { q.value = ""; onInput(); q.focus(); });
  only.addEventListener("click", () => { if (!results.hidden) show(q.value); });
  $$(".chip").forEach((c) => c.addEventListener("click", () => { if (q.value) { q.value = ""; onInput(); } }));

  const initial = new URLSearchParams(location.search).get("q");
  if (initial) { q.value = initial; onInput(); }

  document.documentElement.classList.add("ready");
})();
