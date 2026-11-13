// Flashcards: window.DECKS = [{id, label, title, cards:[{id,k,f,b}]}] for one course.
// Tap the card to flip; then swipe right (got it) or left (again), or use the buttons.
// Learned cards are remembered per course; "Again" brings a card back a few cards later.
(() => {
  const { h, store, shuffle } = Lab;
  const KIND = { def: "Definition", q: "Question", tbl: "Table" };
  const body = document.body;
  const key = "cards:" + body.dataset.course;
  const decks = window.DECKS;
  const app = document.getElementById("app");
  let known = store.get(key, {});
  let deck = new URLSearchParams(location.search).get("deck");
  if (!decks.some((d) => d.id === deck)) deck = "all";
  let mode = "learn"; // learn = only cards not learned yet; all = every card
  let queue = [], pos = 0, flipped = false, startedWith = 0;

  const inDeck = () => decks.filter((d) => deck === "all" || d.id === deck);
  const cardsOf = (ds) => ds.flatMap((d) => d.cards.map((c) => ({ ...c, deck: d })));
  const save = () => store.set(key, known);

  const chips = h("div", { class: "fc-chips", role: "tablist", "aria-label": "Lecture" });
  const stats = h("p", { class: "fc-stats" });
  const stage = h("div", { class: "fc-stage" });
  app.replaceChildren(chips, stats, stage);

  function drawChips() {
    const chip = (id, label, ds) => {
      const all = cardsOf(ds), n = all.filter((c) => known[c.id]).length;
      return h("button", { type: "button", role: "tab", class: "fc-chip", "aria-selected": deck === id, onclick: () => { deck = id; history.replaceState(null, "", id === "all" ? location.pathname : "?deck=" + id); start(); } },
        h("b", null, label), h("small", null, `${n}/${all.length}`));
    };
    chips.replaceChildren(chip("all", "All", decks), ...decks.map((d) => chip(d.id, d.label, [d])));
    const sel = chips.querySelector('[aria-selected="true"]');
    if (sel) chips.scrollLeft += sel.getBoundingClientRect().left - chips.getBoundingClientRect().left - 8;
  }
  function drawStats() {
    const all = cardsOf(inDeck()), n = all.filter((c) => known[c.id]).length;
    stats.replaceChildren(
      h("span", null, h("b", null, all.length - n), " to learn · ", h("b", null, n), " learned"),
      h("button", { type: "button", class: "fc-mode", "aria-pressed": mode === "all", onclick: () => { mode = mode === "all" ? "learn" : "all"; start(); } }, mode === "all" ? "Showing all cards" : "Show all cards"));
  }

  function start() {
    const all = cardsOf(inDeck());
    queue = shuffle(mode === "all" ? all : all.filter((c) => !known[c.id]));
    pos = 0; startedWith = queue.length;
    drawChips(); drawStats(); show();
  }

  function show() {
    flipped = false;
    if (pos >= queue.length) return finish();
    const c = queue[pos];
    const back = h("div", { class: "fc-back", hidden: true, html: c.b });
    const card = h("div", { class: "fc-card fc-" + c.k, role: "button", tabindex: "0", "aria-expanded": "false", "aria-label": "Flashcard. Tap to show the answer" },
      h("p", { class: "fc-kick" }, h("span", null, c.deck.label), ` · ${KIND[c.k]}`, known[c.id] ? h("span", { class: "fc-known" }, " · learned") : null),
      h("div", { class: "fc-front", html: c.f }),
      h("p", { class: "fc-hint" }, "Tap to reveal"),
      back);
    const flip = () => {
      if (flipped) return;
      flipped = true;
      back.hidden = false;
      card.classList.add("is-flipped");
      card.setAttribute("aria-expanded", "true");
      card.querySelector(".fc-hint").hidden = true;
      acts.replaceChildren(
        h("button", { class: "btn btn--warn fc-again", type: "button", onclick: () => decide(false) }, "✗ Again"),
        h("button", { class: "btn fc-got", type: "button", onclick: () => decide(true) }, "✓ Got it"));
    };
    card.addEventListener("click", (e) => { if (!moved && !e.target.closest("a")) flip(); });
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    const acts = h("div", { class: "fc-acts" }, h("button", { class: "btn", type: "button", onclick: flip }, "Show answer"));
    const bar = h("div", { class: "qz-bar fc-bar" }, h("i", { style: `inline-size:${(pos / Math.max(1, queue.length)) * 100}%` }));
    stage.replaceChildren(h("p", { class: "fc-pos" }, `Card ${pos + 1} of ${queue.length}`), bar, card, acts);
    swipe(card, flip);
    if (!matchMedia("(pointer: coarse)").matches) card.focus({ preventScroll: true });
  }

  function decide(got) {
    const c = queue[pos];
    if (got) { known[c.id] = 1; save(); }
    else {
      if (mode === "learn" && known[c.id]) { delete known[c.id]; save(); }
      queue.splice(Math.min(queue.length, pos + 4), 0, c); // see it again soon
    }
    pos++;
    drawChips(); drawStats(); show();
  }

  // horizontal swipe on a flipped card; vertical movement is left to the page (touch-action: pan-y)
  let moved = false;
  function swipe(card, flip) {
    let x0 = null, y0 = 0, dx = 0;
    // a swipe that starts on a table or code block scrolls that instead of sorting the card
    card.addEventListener("pointerdown", (e) => { if (e.target.closest(".tbl-wrap, pre")) return; x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; });
    card.addEventListener("pointermove", (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - y0)) {
        moved = true;
        card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
        card.classList.toggle("is-right", flipped && dx > 60);
        card.classList.toggle("is-left", flipped && dx < -60);
      }
    });
    const end = (e) => {
      if (x0 == null) return;
      if (e.type === "pointercancel") dx = 0; // the browser took over (scrolling): don't decide
      x0 = null;
      card.style.transform = "";
      card.classList.remove("is-right", "is-left");
      if (moved && Math.abs(dx) > 90) { if (flipped) decide(dx > 0); else flip(); }
      setTimeout(() => (moved = false), 0);
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }

  function finish() {
    const all = cardsOf(inDeck()), n = all.filter((c) => known[c.id]).length, left = all.length - n;
    stage.replaceChildren(h("div", { class: "fc-done" },
      h("p", { class: "mk-kicker" }, startedWith ? "Round finished" : mode === "learn" ? "Nothing left to learn here" : "Empty deck"),
      h("p", { class: "mk-score" }, h("b", null, n), ` / ${all.length}`, h("span", null, "cards learned")),
      h("div", { class: "qz-actions" },
        left ? h("button", { class: "btn", type: "button", onclick: () => { mode = "learn"; start(); } }, `Study the ${left} left`) : null,
        h("button", { class: left ? "btn btn--ghost" : "btn", type: "button", onclick: () => { mode = "all"; start(); } }, "Review all cards"),
        n ? h("button", { class: "btn btn--warn", type: "button", onclick: () => { for (const c of all) delete known[c.id]; save(); mode = "learn"; start(); } }, "Reset this deck") : null)));
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || !flipped) return;
    if (e.key === "ArrowRight") decide(true);
    else if (e.key === "ArrowLeft") decide(false);
  });
  start();
})();
