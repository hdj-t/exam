// Mock exams: banks register with Mock.add(id, {title, qs}); the page body says which
// banks to use (data-mock), how many per bank (data-pick, 0 = all) and the time limit.
// Timed exam mode hides answers until Submit; practice mode checks each one as you go.
(() => {
  const { h, esc, store, shuffle, renderQ } = Lab;
  const banks = {};
  const SECTIONS = [
    { id: "A", name: "Multiple choice", types: ["mcq", "multi"] },
    { id: "B", name: "True or false", types: ["tf"] },
    { id: "C", name: "Complete, match and order", types: ["fill", "cmd", "match", "order"] },
    { id: "D", name: "Short answer", types: ["short"] },
  ];
  const marks = (q) => q.m || { multi: 2, match: 2, order: 2, short: 3 }[q.t] || 1;
  const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // n questions from a bank in the same type mix as the bank: spread each type
  // evenly along 0..1, then take the first n
  function pick(qs, n) {
    if (!n || n >= qs.length) return [...qs];
    const by = new Map();
    for (const q of shuffle(qs)) by.set(q.t, [...(by.get(q.t) || []), q]);
    return [...by.values()]
      .flatMap((l) => l.map((q, k) => [(k + Math.random()) / l.length, q]))
      .sort((x, y) => x[0] - y[0]).slice(0, n).map((x) => x[1]);
  }

  function run() {
    const body = document.body;
    const ids = body.dataset.mock.split(",");
    const per = +body.dataset.pick || 0;
    const minutes = +body.dataset.minutes || 30;
    const key = "mock:" + body.dataset.key;
    const app = document.getElementById("app");
    const missing = ids.filter((id) => !banks[id]);
    if (missing.length) { app.replaceChildren(h("p", { class: "noscript" }, "Question bank missing: " + missing.join(", "))); return; }

    // every question gets a stable id (bank#index) so wrong answers can be kept for review
    const bank = (id) => banks[id].qs.map((q, i) => ({ ...q, _id: id + "#" + i }));
    const MKEY = "mock:mistakes";
    const mistakes = () => ids.flatMap(bank).filter((q) => store.get(MKEY, {})[q._id]);

    const intro = () => {
      const pool = ids.flatMap((id) => pick(bank(id), per));
      const missed = mistakes();
      const total = pool.reduce((n, q) => n + marks(q), 0);
      const best = store.get(key + ":best", null);
      const counts = SECTIONS.map((s) => [s, pool.filter((q) => s.types.includes(q.t)).length]).filter(([, n]) => n);
      app.replaceChildren(h("section", { class: "mk-intro" },
        h("p", { class: "mk-kicker" }, ids.length > 1 ? `Mock midterm · ${ids.length} lectures` : "Mock exam"),
        h("h1", { class: "mk-title" }, body.dataset.title),
        ids.length > 1 && h("ul", { class: "mk-scope", role: "list" }, ids.map((id) => h("li", null, banks[id].title))),
        h("dl", { class: "mk-facts" },
          h("div", null, h("dt", null, "Questions"), h("dd", null, pool.length)),
          h("div", null, h("dt", null, "Marks"), h("dd", null, total)),
          h("div", null, h("dt", null, "Time"), h("dd", null, `${minutes} min`)),
          best != null && h("div", null, h("dt", null, "Your best"), h("dd", null, `${best}%`))),
        h("ol", { class: "mk-secs", role: "list" }, counts.map(([s, n]) => h("li", null, h("b", null, `Section ${s.id}`), ` ${s.name} · ${n} question${n > 1 ? "s" : ""}`))),
        h("p", { class: "mk-note" }, ids.length > 1
          ? "Each attempt draws a new set of questions from the lecture banks, so retaking gives you a different exam."
          : "Every attempt shuffles the questions and options. Short answers are marked by key ideas, like the doctor's marking scheme."),
        h("div", { class: "mk-start" },
          h("button", { class: "btn", type: "button", onclick: () => exam(pool, true) }, `▶ Start timed exam`),
          h("button", { class: "btn btn--ghost", type: "button", onclick: () => exam(pool, false) }, "Practice: check as I go"),
          missed.length ? h("button", { class: "btn btn--warn mk-redo", type: "button", onclick: () => exam(missed, false, true) }, `↻ Review my ${missed.length} mistake${missed.length > 1 ? "s" : ""}`) : null)));
    };

    function exam(pool, timed, review) {
      const qs = SECTIONS.flatMap((s) => shuffle(pool.filter((q) => s.types.includes(q.t))).map((q) => ({ ...q, sec: s })));
      const total = qs.reduce((n, q) => n + marks(q), 0);
      Mock.current = qs;
      const res = new Array(qs.length).fill(null);
      const answered = new Set();
      // count down from a deadline, not by ticks: a sleeping phone or a background
      // tab throttles timers, and the exam must still end on time
      const end = Date.now() + minutes * 60000;
      let timer = null, tick = null, over = false;

      const clock = h("b", { class: "mk-clock" });
      const count = h("span", { class: "mk-count" });
      const bar = h("div", { class: "qz-bar" }, h("i"));
      const submitTop = h("button", { class: "btn btn--s", type: "button", onclick: () => ask() }, "Submit");
      const head = h("div", { class: "mk-head" }, h("div", { class: "mk-head-r" }, timed ? clock : h("b", { class: "mk-clock" }, "Practice"), count, submitTop), bar);
      const result = h("div", { class: "mk-result", hidden: true, tabindex: "-1" });
      const confirmBox = h("div", { class: "mk-confirm", hidden: true });
      const list = h("div", { class: "mk-list" });
      const items = [];
      let sec = null, ol = null;
      qs.forEach((q, i) => {
        if (q.sec !== sec) {
          sec = q.sec;
          const n = qs.filter((x) => x.sec === sec).reduce((a, x) => a + marks(x), 0);
          ol = h("ol", { class: "qz-list", role: "list", start: i + 1 });
          list.append(h("h2", { class: "mk-sec" }, `Section ${sec.id} · ${sec.name}`, h("small", null, `${n} marks`)), ol);
        }
        const it = renderQ({ ...q, m: marks(q) }, i, (r) => { res[i] = r; answered.add(i); upd(); if (!timed && res.every((x) => x != null)) finish(); }, timed);
        const touch = () => { if (!over) { answered.add(i); upd(); } };
        it.el.addEventListener("change", touch);
        it.el.addEventListener("input", (e) => { if (e.target.value.trim()) touch(); else { answered.delete(i); upd(); } });
        it.el.addEventListener("click", (e) => { if (e.target.closest(".qz-ob")) touch(); });
        ol.append(it.el);
        items.push(it);
      });
      if (!timed) submitTop.textContent = "Finish";
      const submitBtn = h("button", { class: "btn", type: "button", onclick: () => ask() }, timed ? "Submit exam" : "Finish practice");
      const foot = h("div", { class: "mk-foot" }, confirmBox, submitBtn);
      app.replaceChildren(result, head, list, foot);
      scrollTo({ top: 0 });

      function upd() {
        count.textContent = `${answered.size}/${qs.length} answered`;
        bar.firstChild.style.inlineSize = (answered.size / qs.length) * 100 + "%";
      }
      upd();
      if (timed) {
        tick = () => {
          const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
          clock.textContent = "⏱ " + mmss(left);
          clock.classList.toggle("is-low", left <= 120);
          if (!left) finish(true);
        };
        tick();
        timer = setInterval(tick, 1000);
        document.addEventListener("visibilitychange", tick);
        addEventListener("beforeunload", leaving);
      }

      function leaving(e) { if (!over) e.preventDefault(); }

      function ask() {
        if (over) return;
        const blank = qs.length - answered.size;
        if (!blank) return finish();
        confirmBox.replaceChildren(
          h("p", null, `${blank} question${blank > 1 ? "s are" : " is"} still blank and will score 0.`),
          h("div", { class: "qz-actions" },
            h("button", { class: "btn", type: "button", onclick: () => finish() }, "Submit anyway"),
            h("button", { class: "btn btn--ghost", type: "button", onclick: () => { confirmBox.hidden = true; const i = qs.findIndex((_, k) => !answered.has(k)); items[i].el.scrollIntoView({ block: "start" }); } }, "Go to first blank")));
        confirmBox.hidden = false;
        confirmBox.scrollIntoView({ block: "nearest" });
      }

      function finish(timeUp) {
        if (over) return;
        over = true;
        clearInterval(timer);
        removeEventListener("beforeunload", leaving);
        if (tick) document.removeEventListener("visibilitychange", tick);
        items.forEach((it, i) => { if (res[i] == null) res[i] = it.submit(); });
        const got = res.reduce((n, r, i) => n + (r || 0) * marks(qs[i]), 0);
        const pct = Math.round((got / total) * 100);
        if (!review && pct > store.get(key + ":best", -1)) store.set(key + ":best", pct);
        const ms = store.get(MKEY, {});
        qs.forEach((q, i) => { if (res[i] === 1) delete ms[q._id]; else ms[q._id] = (ms[q._id] || 0) + 1; });
        store.set(MKEY, ms);
        const missedNow = qs.filter((_, i) => res[i] !== 1);
        const band = pct >= 90 ? "Excellent" : pct >= 80 ? "Very good" : pct >= 70 ? "Good" : pct >= 60 ? "Fair" : pct >= 50 ? "Pass" : "Below pass";
        const secs = SECTIONS.map((s) => {
          const ix = qs.map((q, i) => (q.sec === s ? i : -1)).filter((i) => i >= 0);
          if (!ix.length) return null;
          const g = ix.reduce((n, i) => n + (res[i] || 0) * marks(qs[i]), 0), t = ix.reduce((n, i) => n + marks(qs[i]), 0);
          return h("li", null, h("span", null, `Section ${s.id} · ${s.name}`), h("b", null, `${fmt(g)} / ${t}`));
        });
        const wrong = res.map((r, i) => (r === 1 ? null : i)).filter((i) => i != null);
        result.replaceChildren(
          h("p", { class: "mk-kicker" }, timeUp ? "Time is up · your exam was submitted" : review ? "Mistake review finished" : timed ? "Exam submitted" : "Practice finished"),
          h("p", { class: "mk-score" }, h("b", null, fmt(got)), ` / ${total}`, h("span", null, `${pct}% · ${band}`)),
          h("ul", { class: "mk-break", role: "list" }, secs),
          wrong.length
            ? h("div", { class: "mk-review" }, h("p", null, "Review the ones you lost marks on:"), h("div", { class: "mk-jumps" }, wrong.map((i) => h("a", { href: "#q" + (i + 1), class: res[i] > 0 ? "is-part" : "" }, "Q" + (i + 1)))))
            : h("p", null, "Full marks. Try a new attempt to see other questions."),
          h("div", { class: "qz-actions" },
            missedNow.length ? h("button", { class: "btn btn--warn", type: "button", onclick: () => exam(missedNow, false, true) }, `↻ Redo the ${missedNow.length} I missed`) : null,
            h("button", { class: "btn", type: "button", onclick: intro }, ids.length > 1 ? "New exam (new questions)" : "Take it again"),
            h("a", { class: "btn btn--ghost", href: body.dataset.back }, "Back to course")));
        result.hidden = false;
        head.hidden = true;
        foot.replaceChildren();
        result.scrollIntoView({ block: "start" });
        result.focus({ preventScroll: true });
      }
    }
    intro();
  }

  window.Mock = { add: (id, bank) => (banks[id] = bank), banks };
  document.addEventListener("DOMContentLoaded", run);
})();
