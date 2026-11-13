#!/usr/bin/env node
// Builds the site from data/courses.json and files/<course>/<file>.pdf.
//   pages/<course>/<file>/<n>.webp   page images for the in-site reader (cached)
//   read/<course>/<file>.html        one reader page per document
//   data/search.json                 per-page text for full-text search
//   index.html                       the home page
// Needs Node 18+, poppler-utils (pdfinfo, pdftotext, pdftoppm) and ImageMagick.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "data/courses.json"), "utf8"));
const WIDTH = 1100; // px; sharp on phones at 2–3x, small enough to scroll fast
const QUALITY = 70;
const KIND = {
  lecture: { label: "Lectures", short: "L" },
  lab: { label: "Labs", short: "Lab " },
  assignment: { label: "Assignments", short: "A" },
  interactive: { label: "Interactive labs", short: "▶ " },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");
const fmtDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const docLabel = (d) => (KIND[d.kind]?.short ?? "") + d.n;

function inScope(course, doc) {
  const s = course.scope;
  if (!s?.confirmed) return null; // unknown
  if (doc.kind === "lecture") {
    const nums = doc.nums ?? [doc.n];
    return nums.some((n) => s.lectures?.includes(n));
  }
  if (doc.kind === "lab") return s.labs === undefined ? null : !!s.labs;
  if (doc.kind === "assignment") return s.lectures?.includes(doc.for) ?? null;
  return null;
}

function render(pdf, outDir) {
  const stat = fs.statSync(pdf);
  const stamp = `${stat.size}:${stat.mtimeMs}:${WIDTH}:${QUALITY}`;
  const stampFile = path.join(outDir, ".stamp");
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) return;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exam-"));
  run("pdftoppm", ["-png", "-scale-to-x", String(WIDTH), "-scale-to-y", "-1", pdf, path.join(tmp, "p")]);
  for (const f of fs.readdirSync(tmp)) {
    const n = parseInt(f.match(/(\d+)\.png$/)[1], 10);
    run("magick", [path.join(tmp, f), "-quality", String(QUALITY), path.join(outDir, `${n}.webp`)]);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(stampFile, stamp);
}

function pageSizes(dir, count) {
  const out = run("magick", ["identify", "-format", "%w %h\n", ...Array.from({ length: count }, (_, i) => path.join(dir, `${i + 1}.webp`))]);
  return out.trim().split("\n").map((l) => l.split(" ").map(Number));
}

// ---------------------------------------------------------------- collect
const search = [];
for (const c of site.courses) {
  for (const d of c.docs) {
    const pdf = path.join(ROOT, "files", c.id, d.file + ".pdf");
    if (!fs.existsSync(pdf)) throw new Error("missing " + pdf);
    d.id = `${c.id}/${d.file}`;
    d.pdf = `files/${c.id}/${d.file}.pdf`;
    d.size = fs.statSync(pdf).size;
    d.pages = parseInt(run("pdfinfo", [pdf]).match(/^Pages:\s+(\d+)/m)[1], 10);
    d.exam = inScope(c, d);
    if (d.lab && !fs.existsSync(path.join(ROOT, "labs", c.id, d.file + ".js"))) { console.warn(`lab script missing for ${d.id}`); d.lab = null; }
    if (d.lab) d.labUrl = `labs/${d.id}.html`;
    const dir = path.join(ROOT, "pages", c.id, d.file);
    process.stdout.write(`render ${d.id} (${d.pages}p)\n`);
    render(pdf, dir);
    d.sizes = pageSizes(dir, d.pages);
    const text = run("pdftotext", ["-enc", "UTF-8", pdf, "-"]).split("\f").slice(0, d.pages);
    search.push({
      id: d.id,
      c: c.id,
      t: `${c.name} · ${docLabel(d)} · ${d.title}`,
      p: text.map((t) => t.replace(/[\u0000-\u001f\s]+/g, " ").trim()),
    });
  }
}
fs.writeFileSync(path.join(ROOT, "data/search.json"), JSON.stringify(search));

// ---------------------------------------------------------------- shared
const head = (title, rel, desc) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#F6F3EC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171513" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${rel}favicon.svg" type="image/svg+xml">
<link rel="preload" href="${rel}fonts/GeistPixel-Square.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${rel}styles.css">
</head>`;

const MARK = `<svg class="mark" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
<path fill="currentColor" d="M3 1h7v1H3zM10 2h1v1h-1zM11 3h1v1h-1zM12 4h1v11H3V1h1v13h8V5h-3V2h1v2h2z"/>
<path class="mark-a" d="M6 7h5v1H6zM6 9h5v1H6zM6 11h3v1H6z"/>
</svg>`;

// ---------------------------------------------------------------- reader pages
for (const c of site.courses) {
  c.docs.forEach((d, i) => {
    const prev = c.docs[i - 1], next = c.docs[i + 1];
    const rel = "../../";
    const tag = d.exam === true ? `<span class="tag tag--exam">In exam</span>` : d.exam === false ? `<span class="tag tag--out">Not in exam</span>` : "";
    const pages = d.sizes
      .map(([w, h], k) => `<figure class="page" id="p${k + 1}"><img src="${rel}pages/${d.id}/${k + 1}.webp" width="${w}" height="${h}" alt="Page ${k + 1} of ${esc(d.title)}"${k > 1 ? ' loading="lazy" decoding="async"' : ""}><figcaption>${k + 1}</figcaption></figure>`)
      .join("\n");
    const navLink = (x, dir) =>
      x ? `<a class="pn pn--${dir}" href="${esc(x.file)}.html"><span class="pn-k">${dir === "prev" ? "← Previous" : "Next →"}</span><span class="pn-t">${esc(docLabel(x))} · ${esc(x.title)}</span></a>` : `<span></span>`;
    const html = `${head(`${docLabel(d)} · ${d.title} — ${c.name}`, rel, `${c.name}: ${d.title}`)}
<body class="reader" data-doc="${esc(d.id)}" data-title="${esc(c.name + " · " + docLabel(d) + " · " + d.title)}" data-pages="${d.pages}">
<header class="rbar">
  <a class="icon-btn" href="${rel}index.html#${c.id}" aria-label="Back to ${esc(c.name)}"><span aria-hidden="true">←</span></a>
  <div class="rbar-t">
    <span class="rbar-c">${esc(c.name)} · ${esc(docLabel(d))}</span>
    <b>${esc(d.title)}</b>
  </div>
  <span class="pc" aria-live="off"><span id="pc-n">1</span>/${d.pages}</span>
  <a class="icon-btn icon-btn--pdf" href="${rel}${d.pdf}" download aria-label="Download PDF (${kb(d.size)})">PDF</a>
  <div class="progress" aria-hidden="true"><i id="progress"></i></div>
</header>
<div class="hits" id="hits" hidden></div>
<main class="pages" id="main">
<p class="rinfo">${tag}<span>${d.pages} pages · ${kb(d.size)}</span> <a href="${rel}${d.pdf}">Open original PDF ↗</a></p>
${d.lab ? `<a class="labcta" href="${rel}${d.labUrl}"><b>▶ Try it as an interactive lab</b><span>Run the commands in a simulator, check each step, then take the quiz</span></a>` : ""}
${pages}
</main>
<nav class="pager" aria-label="More in ${esc(c.name)}">${navLink(prev, "prev")}${navLink(next, "next")}</nav>
<script src="${rel}reader.js" defer></script>
</body>
</html>
`;
    fs.mkdirSync(path.join(ROOT, "read", c.id), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "read", c.id, d.file + ".html"), html);
  });
}

// ---------------------------------------------------------------- interactive labs
// A doc with "lab": [...modules] has labs/<course>/<file>.js; this writes its page.
for (const c of site.courses) for (const d of c.docs) {
  if (!d.lab) continue;
  const rel = "../../";
  const mods = ["engine", ...d.lab].map((m) => `<script src="../${m}.js" defer></script>`).join("\n");
  const html = `${head(`Interactive ${docLabel(d)} · ${d.title} — ${c.name}`, rel, `Interactive lab: ${d.title} (${c.name})`).replace("</head>", `<link rel="stylesheet" href="../lab.css">\n</head>`)}
<body class="lab" data-lab="${esc(d.id)}" data-guide="${rel}read/${d.id}.html">
<header class="rbar">
  <a class="icon-btn" href="${rel}index.html#${c.id}" aria-label="Back to ${esc(c.name)}"><span aria-hidden="true">←</span></a>
  <div class="rbar-t">
    <span class="rbar-c">${esc(c.name)} · Interactive ${esc(docLabel(d))}</span>
    <b>${esc(d.title)}</b>
  </div>
  <a class="icon-btn icon-btn--pdf" href="${rel}read/${d.id}.html" aria-label="Open the handout">Guide</a>
</header>
<nav class="tabs" id="tabs" role="tablist" aria-label="Lab sections"></nav>
<main id="app"><p class="noscript">This interactive lab needs JavaScript. You can still <a href="${rel}read/${d.id}.html">read the handout</a>.</p></main>
${mods}
<script src="${esc(d.file)}.js" defer></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(ROOT, "labs", c.id, d.file + ".html"), html);
}

// ---------------------------------------------------------------- home
const sorted = [...site.courses].sort((a, b) => a.exam.localeCompare(b.exam));
const chips = sorted
  .map((c) => `<a class="chip" href="#${c.id}" data-course="${c.id}"><b>${esc(short(c.name))}</b><span>${esc(fmtDate(c.exam).replace(/^\w+ /, ""))}</span></a>`)
  .join("");
function short(n) {
  return { "Cloud Computing": "Cloud", "Web Applications Security": "Web Sec", "Advanced Cybersecurity": "Adv Cyber", "Network Security": "Net Sec", "Cybersecurity Governance": "Governance" }[n] ?? n;
}

const courseHtml = sorted
  .map((c) => {
    const groups = Object.keys(KIND)
      .map((k) => {
        const docs = c.docs.filter((d) => d.kind === k);
        if (!docs.length) return "";
        const rows = docs
          .map(
            (d) => `<li class="doc${d.exam === true ? " is-exam" : d.exam === false ? " is-out" : ""}" data-exam="${d.exam}">
<a class="doc-a" href="read/${d.id}.html"><span class="num">${esc(docLabel(d))}</span><span class="doc-t"><b>${esc(d.title)}</b><small>${d.pages} pages${d.exam === true ? ' · <em class="tag tag--exam">In exam</em>' : d.exam === false ? ' · <em class="tag tag--out">Not in exam</em>' : ""}</small></span></a>
${d.lab ? `<a class="doc-lab" href="${d.labUrl}" aria-label="Interactive lab: ${esc(d.title)}"><span aria-hidden="true">▶</span><small>LAB</small></a>` : ""}
<a class="doc-dl" href="${d.pdf}" download aria-label="Download ${esc(d.title)} PDF, ${kb(d.size)}"><span aria-hidden="true">↓</span><small>PDF</small></a>
</li>`
          )
          .join("\n");
        return `<h3 class="group">${KIND[k].label} <span>${docs.length}</span></h3>\n<ol class="docs" role="list">\n${rows}\n</ol>`;
      })
      .join("\n");
    const s = c.scope;
    const scope = `<p class="scope ${s.confirmed ? "scope--ok" : "scope--tba"}"><span class="scope-k">${s.confirmed ? "Exam scope" : "Scope"}</span> ${esc(s.note)}${s.missing ? ` <strong class="missing">${esc(s.missing)}</strong>` : ""}</p>`;
    return `<section class="course" id="${c.id}" data-exam="${c.exam}" aria-labelledby="h-${c.id}">
<header class="course-h">
  <p class="course-date"><time datetime="${c.exam}">${esc(fmtDate(c.exam))}</time> <span class="countdown" data-date="${c.exam}"></span></p>
  <h2 id="h-${c.id}">${esc(c.name)}</h2>
  <p class="course-meta"><span class="code">${esc(c.code)}</span> <span lang="ar" dir="rtl">${esc(c.ar)}</span></p>
  ${scope}
</header>
${groups}
</section>`;
  })
  .join("\n");

const totalPages = site.courses.reduce((n, c) => n + c.docs.reduce((m, d) => m + d.pages, 0), 0);
const index = `${head("exam — midterm material", "", site.subtitle)}
<body class="home">
<a class="skip-link" href="#courses">Skip to courses</a>
<header class="top">
  <a class="brand" href="./" aria-label="exam, home">${MARK}<span>exam</span><i class="cursor" aria-hidden="true"></i></a>
  <p class="sub">${esc(site.subtitle)}</p>
</header>
<div class="bar" id="bar">
  <search class="search">
    <label class="vh" for="q">Search all lectures and labs</label>
    <input id="q" type="search" placeholder="Search titles and inside slides…" autocomplete="off" enterkeyhint="search" spellcheck="false">
    <button class="search-x" id="qx" type="button" aria-label="Clear search" hidden>×</button>
  </search>
  <div class="bar-row">
    <nav class="chips" aria-label="Jump to course">${chips}</nav>
    <button class="toggle" id="only" type="button" aria-pressed="false" title="Show only material that's in the exam"><span class="toggle-box" aria-hidden="true"></span>Exam only</button>
  </div>
</div>
<main id="courses">
<section class="results" id="results" aria-live="polite" hidden></section>
<div class="lists" id="lists">
<a class="continue" id="continue" hidden></a>
<p class="next" id="next" hidden></p>
${courseHtml}
</div>
</main>
<footer class="foot"><p>${site.courses.length} courses · ${site.courses.reduce((n, c) => n + c.docs.length, 0)} files · ${totalPages} pages. Tap a file to read it here, or ↓ to save the PDF.</p></footer>
<script src="app.js" defer></script>
</body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), index);
console.log(`done: ${totalPages} pages`);
