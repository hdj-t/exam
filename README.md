# exam

Midterm material for 4th stage Cybersecurity Engineering: lectures, labs and assignments, readable on a phone.

**Live site:** https://hdj-t.github.io/exam/

| Exam | Date | Scope |
|---|---|---|
| Cloud Computing (CSTE4103) | Tue 17 Nov | Lectures 1–5, no labs |
| Web Applications Security (CSTE4107) | Wed 18 Nov | not announced |
| Advanced Cybersecurity (CSTE4101) | Wed 25 Nov | Lectures 1–3 |
| Network Security (CSTE4102) | Thu 26 Nov | Lectures 1–4 |
| Cybersecurity Governance (CSTE4104) | Thu 3 Dec | not announced |

- Exams in date order with countdowns, course chips to jump between them, and an **Exam only** switch.
- Search finds words inside every slide and page, then opens the file on that page.
- Every file opens in an in-page reader (page images, page counter, saves where you stopped), or ↓ downloads the original PDF.

## Interactive labs

Every lab (and every Web Security lecture) has a ▶ LAB page: a Brief, auto-checked tasks with hints, and a mixed-format quiz (MCQ, multi-select, true/false, fill-in, type-the-command, ordering, matching, short answer) with sources.

- **Network Security 1–6**: Cisco IOS simulator (port security, ACLs, IPsec VPN with the security license), Packet Tracer PCs, Simulation Mode, Wireshark-style capture, Kali `arpspoof`, `nmap`.
- **Advanced Cybersecurity 1–2**: AppLocker (secpol, gpupdate, Event Viewer) and ManageEngine Endpoint Central.
- **Web Security 1–7**: PortSwigger-style challenges with a simulated browser, Burp (Proxy, Repeater, Intruder, Decoder) and an exploit server. Payloads are parsed and simulated, never executed.
- **Cloud Computing 1–4**: console explorer, pricing workbench, VMware/Ubuntu install, clone/export/import.

Engine: `labs/engine.js`, `labs/net.js`, `labs/kit.js`, `labs/webkit.js`; one script per lab in `labs/<course>/`.

## Summaries

`summaries/<course>/<lecture>.md` (definitions, `Q/` questions, comparison tables, a playful Arabic title) build into `summary/…html` + a printable PDF, and are part of the search.

## Adding a file

1. Put the PDF in `files/<course>/` with a simple name, such as `lecture-4-....pdf`.
2. Add it to `docs` for that course in `data/courses.json` (`kind`, `n`, `title`, `file`). Exam scope is in `scope`.
3. Run `node tools/build.mjs` (needs Node 18+, poppler-utils and ImageMagick), then commit and push.

The design comes from [op-h/DBs](https://github.com/op-h/DBs): paper and ink, Geist Pixel, notched pixel borders, a green accent.
