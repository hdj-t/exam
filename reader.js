// Reader: page counter + progress bar, remembers where you stopped, and shows
// the search hits you came from (?q=…&hits=3,5).
(() => {
  const body = document.body;
  const pages = [...document.querySelectorAll(".page")];
  const n = document.getElementById("pc-n");
  const bar = document.getElementById("progress");
  const total = +body.dataset.pages;
  let current = 1;

  const save = () => {
    try {
      localStorage.setItem("last-read", JSON.stringify({
        href: location.pathname.split("/").slice(-3).join("/"),
        title: body.dataset.title, page: current, pages: total,
      }));
    } catch {}
  };

  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      current = +e.target.id.slice(1);
      n.textContent = current;
      bar.style.inlineSize = (current / total) * 100 + "%";
      save();
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  pages.forEach((p) => io.observe(p));

  // Pages above a #pN jump are lazy; load them so the jump doesn't drift.
  if (location.hash) pages.forEach((p) => p.querySelector("img").loading = "eager");

  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  const hits = (params.get("hits") || "").split(",").map(Number).filter(Boolean);
  if (q && hits.length) {
    const box = document.getElementById("hits");
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    box.innerHTML = `<b>“${esc(q)}”</b> on page${hits.length > 1 ? "s" : ""} ` +
      hits.map((h) => `<a href="#p${h}">${h}</a>`).join(" ") +
      ` <a href="../../index.html?q=${encodeURIComponent(q)}">← results</a>`;
    box.hidden = false;
    hits.forEach((h) => document.getElementById("p" + h)?.classList.add("is-hit"));
  }
})();
