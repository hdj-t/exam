// Network simulator for the Packet Tracer labs: PCs, Cisco 2960 switches and 2911 routers.
// Frames flood through switches (with port-security), routers do ARP, static routes,
// numbered ACLs and site-to-site IPsec (crypto maps). Devices are driven through a Cisco
// IOS command line (Net.ios) or the Packet Tracer PC command prompt (Net.pcPrompt).
(() => {
  "use strict";
  const { h } = Lab;

  // ------------------------------------------------------------------ addressing
  const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split(".").every((o) => +o <= 255);
  const ip2n = (s) => s.split(".").reduce((a, o) => a * 256 + +o, 0);
  const isMask = (s) => isIp(s) && /^1*0*$/.test(ip2n(s).toString(2).padStart(32, "0"));
  const plen = (m) => (ip2n(m).toString(2).match(/1/g) || []).length;
  const netOf = (ip, m) => ((ip2n(ip) & ip2n(m)) >>> 0);
  const n2ip = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
  const same = (a, b, m) => isIp(a) && isIp(b) && isMask(m) && netOf(a, m) === netOf(b, m);
  const wcMatch = (ip, base, wc) => (((ip2n(ip) ^ ip2n(base)) & ~ip2n(wc)) >>> 0) === 0;

  // interface names: fa0/1, f0/1, FastEthernet0/1, g0/0, gi0/0, GigabitEthernet0/0
  function canonIf(t) {
    const m = /^([a-z]+)\s*(\d+\/\d+)$/i.exec(t);
    if (!m) return null;
    const p = m[1].toLowerCase();
    if ("fastethernet".startsWith(p)) return "FastEthernet" + m[2];
    if ("gigabitethernet".startsWith(p)) return "GigabitEthernet" + m[2];
    return null;
  }
  const shortIf = (n) => n.replace("FastEthernet", "Fa").replace("GigabitEthernet", "Gi");
  const tokenize = (line) => {
    const raw = line.trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      if (/^[fg][a-z]*$/i.test(raw[i]) && /^\d+\/\d+$/.test(raw[i + 1] || "") && canonIf(raw[i] + raw[i + 1])) { out.push(raw[i] + raw[i + 1]); i++; }
      else out.push(raw[i]);
    }
    return out;
  };

  // ------------------------------------------------------------------ devices
  const PS = () => ({ on: false, max: 1, sticky: false, violation: "shutdown", secure: [], count: 0, err: false, last: null });
  function makePC(id, o) { return { id, type: "pc", name: o.name || id, mac: o.mac, ip: o.ip || "", mask: o.mask || "", gw: o.gw || "", arp: {}, port: "FastEthernet0" }; }
  function makeSwitch(id, o = {}) {
    const ports = {};
    for (let i = 1; i <= 24; i++) ports["FastEthernet0/" + i] = { shutdown: false, mode: "auto", ps: PS(), desc: "" };
    for (let i = 1; i <= 2; i++) ports["GigabitEthernet0/" + i] = { shutdown: false, mode: "auto", ps: PS(), desc: "" };
    return { id, type: "switch", model: "2960", hostname: o.hostname || "Switch", ports, mac: o.mac, macTable: {}, startup: null, mode: "user", cur: null };
  }
  function makeRouter(id, o = {}) {
    const ifaces = {};
    ["GigabitEthernet0/0", "GigabitEthernet0/1", "GigabitEthernet0/2"].forEach((n, k) => {
      ifaces[n] = { ip: "", mask: "", shutdown: true, aclIn: null, aclOut: null, cmap: null, desc: "", mac: o.mac.replace(/.$/, (c) => (parseInt(c, 16) + k + 1).toString(16).toUpperCase()) };
    });
    return {
      id, type: "router", model: "2911", baseMac: o.mac, hostname: o.hostname || "Router", ifaces, routes: [], acls: {}, isakmp: {}, keys: {}, tsets: {}, cmaps: {},
      license: !!o.license, licNext: !!o.license, sa: {}, arp: {}, startup: null, mode: "user", cur: null,
    };
  }
  // the parts of a device that "write" saves and "reload" restores
  const CFG_KEYS = { switch: ["hostname", "ports"], router: ["hostname", "ifaces", "routes", "acls", "isakmp", "keys", "tsets", "cmaps", "licNext"] };
  const cfgOf = (d) => {
    const o = {};
    for (const k of CFG_KEYS[d.type]) o[k] = d[k];
    return JSON.parse(JSON.stringify(o, (k, v) => (k === "count" || k === "err" || k === "last" || k === "hits" ? undefined : v)));
  };

  // ------------------------------------------------------------------ network
  class Network {
    constructor() {
      this.dev = {};
      this.links = [];
      this.capture = null;
      this.log = () => {};
      this.changed = () => {};
      this.anim = null;
      this.lastFail = "";
      this.prevUp = new Map();
      this.booting = true;
    }
    add(d) { this.dev[d.id] = d; return d; }
    pc(id, o) { return this.add(makePC(id, o)); }
    switch(id, o) { return this.add(makeSwitch(id, o)); }
    router(id, o) { return this.add(makeRouter(id, o)); }
    link(a, ap, b, bp) { this.links.push({ a, ap, b, bp }); this.settle(); }
    unlink(dev, port) { this.links = this.links.filter((l) => !((l.a === dev && (!port || l.ap === port)) || (l.b === dev && (!port || l.bp === port)))); this.settle(); }
    linkAt(dev, port) { return this.links.find((l) => (l.a === dev && l.ap === port) || (l.b === dev && l.bp === port)); }
    peer(dev, port) {
      const l = this.linkAt(dev, port);
      if (!l) return null;
      return l.a === dev && l.ap === port ? { dev: l.b, port: l.bp } : { dev: l.a, port: l.ap };
    }
    portUp(id, port) {
      const d = this.dev[id];
      if (d.type === "pc") return true;
      if (d.type === "switch") { const p = d.ports[port]; return !p.shutdown && !p.ps.err; }
      return !d.ifaces[port].shutdown;
    }
    linkUp(l) { return !!l && this.portUp(l.a, l.ap) && this.portUp(l.b, l.bp); }
    upAt(dev, port) { return this.linkUp(this.linkAt(dev, port)); }
    // log LINK/LINEPROTO changes on switches and routers whenever a link changes state
    settle(quiet) {
      const seen = new Set();
      for (const l of this.links) {
        const k = `${l.a}|${l.ap}|${l.b}|${l.bp}`;
        seen.add(k);
        const up = this.linkUp(l), was = this.prevUp.get(k);
        if (((was !== undefined && was !== up) || (was === undefined && up && !this.booting)) && !quiet) for (const [d, p] of [[l.a, l.ap], [l.b, l.bp]]) this.linkLog(d, p, up);
        this.prevUp.set(k, up);
      }
      for (const k of [...this.prevUp.keys()]) if (!seen.has(k)) {
        const [a, ap, b, bp] = k.split("|");
        if (this.prevUp.get(k) && !quiet) { this.dev[a] && this.linkLog(a, ap, false); this.dev[b] && this.linkLog(b, bp, false); }
        this.prevUp.delete(k);
      }
      this.changed();
    }
    linkLog(id, port, up) {
      const d = this.dev[id];
      if (d.type === "pc") return;
      const admin = d.type === "switch" ? d.ports[port].shutdown : d.ifaces[port].shutdown;
      if (up) this.log(id, `%LINK-5-CHANGED: Interface ${port}, changed state to up\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port}, changed state to up`);
      else if (admin) this.log(id, `%LINK-5-CHANGED: Interface ${port}, changed state to administratively down\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port}, changed state to down`);
      else this.log(id, `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port}, changed state to down\n%LINK-3-UPDOWN: Interface ${port}, changed state to down`);
    }

    // port-security check on a frame entering a switch port; false = dropped
    ingress(sw, port, mac) {
      const p = sw.ports[port];
      p.ps.last = mac;
      const ps = p.ps;
      if (ps.on && p.mode === "access") {
        if (!ps.secure.some((s) => s.mac === mac)) {
          if (ps.secure.length < ps.max) {
            ps.secure.push({ mac, type: ps.sticky ? "SecureSticky" : "SecureDynamic" });
            this.changed();
          } else {
            ps.count++;
            if (ps.violation === "shutdown") {
              ps.err = true;
              this.log(sw.id, `%PM-4-ERR_DISABLE: psecure-violation error detected on ${shortIf(port)}, putting ${shortIf(port)} in err-disable state\n%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${mac} on port ${port}.`);
              this.settle();
            } else if (ps.violation === "restrict") {
              this.log(sw.id, `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${mac} on port ${port}.`);
            }
            this.changed();
            return false;
          }
        }
      }
      sw.macTable[mac] = port;
      return true;
    }
    // flood a frame from (dev, port); returns the end devices it reached and the path to each
    l2(from, port, mac) {
      const ends = [], parent = { [from]: null }, q = [];
      const l = this.linkAt(from, port);
      if (!this.linkUp(l)) return { ends, parent };
      const first = this.peer(from, port);
      q.push([first.dev, first.port, from]);
      while (q.length) {
        const [id, inPort, prev] = q.shift();
        if (id in parent && id !== from) continue;
        parent[id] = prev;
        const d = this.dev[id];
        if (d.type === "switch") {
          if (!this.ingress(d, inPort, mac)) continue;
          for (const pn of Object.keys(d.ports)) {
            if (pn === inPort) continue;
            const ll = this.linkAt(id, pn);
            if (!this.linkUp(ll)) continue;
            const nx = this.peer(id, pn);
            if (!(nx.dev in parent)) q.push([nx.dev, nx.port, id]);
          }
        } else ends.push({ dev: id, port: inPort });
      }
      return { ends, parent };
    }
    pathTo(parent, id) { const p = []; for (let x = id; x != null; x = parent[x]) p.unshift(x); return p; }
    ipOn(d, port) {
      if (d.type === "pc") return d.ip;
      if (d.type === "router") { const i = d.ifaces[port]; return !i.shutdown && i.ip ? i.ip : null; }
      return null;
    }
    macOn(d, port) { return d.type === "router" ? d.ifaces[port].mac : d.mac; }
    event(e) { if (this.capture) this.capture.push({ n: this.capture.length + 1, t: (performance.now() / 1000).toFixed(6), ...e }); }

    // ARP for nh out of (d, port). {ok} or {miss:true} (resolved now, packet lost) or {fail}
    arp(d, port, nh) {
      const cache = d.arp;
      if (cache[nh]) return { ok: true, mac: cache[nh] };
      const myIp = this.ipOn(d, port), myMac = this.macOn(d, port);
      const r = this.l2(d.id, port, myMac);
      const tgt = r.ends.find((e) => this.ipOn(this.dev[e.dev], e.port) === nh);
      this.event({ proto: "ARP", src: myMac, dst: "Broadcast", info: `Who has ${nh}? Tell ${myIp}`, path: tgt ? this.pathTo(r.parent, tgt.dev) : [d.id] });
      if (!tgt) return { fail: true };
      const T = this.dev[tgt.dev];
      T.arp[myIp] = myMac;
      const tmac = this.macOn(T, tgt.port);
      const back = this.l2(T.id, tgt.port, tmac);
      if (!back.ends.some((e) => e.dev === d.id)) return { fail: true };
      this.event({ proto: "ARP", src: tmac, dst: myMac, info: `${nh} is at ${tmac}`, path: this.pathTo(back.parent, d.id) });
      cache[nh] = tmac;
      return { miss: true, mac: tmac };
    }

    // routing table of a router: connected + static, longest prefix first
    routes(r) {
      const out = [];
      for (const [n, i] of Object.entries(r.ifaces)) if (i.ip && i.mask && !i.shutdown && this.upAt(r.id, n)) out.push({ code: "C", net: n2ip(netOf(i.ip, i.mask)), mask: i.mask, iface: n, ip: i.ip });
      for (const s of r.routes) {
        const c = out.find((x) => x.code === "C" && same(s.nh, x.ip, x.mask));
        if (c) out.push({ code: "S", net: s.net, mask: s.mask, iface: c.iface, nh: s.nh });
      }
      return out;
    }
    lookup(r, dst) {
      return this.routes(r).filter((x) => same(dst, x.net, x.mask)).sort((a, b) => plen(b.mask) - plen(a.mask))[0] || null;
    }

    // numbered ACL check; true = permit
    acl(r, num, pkt) {
      const a = r.acls[num];
      if (!a || !a.entries.length) return true;
      for (const e of a.entries) {
        if (this.aclMatch(e, pkt, a.type)) { e.hits = (e.hits || 0) + 1; return e.action === "permit"; }
      }
      return false;
    }
    aclMatch(e, p, type) {
      const addr = (spec, ip) => spec.any || wcMatch(ip, spec.ip, spec.wc);
      if (type === "standard") return addr(e.src, p.src);
      if (e.proto !== "ip" && e.proto !== p.proto) return false;
      if (!addr(e.src, p.src) || !addr(e.dst, p.dst)) return false;
      if (e.icmp && p.proto === "icmp" && e.icmp !== (p.kind === "reply" ? "echo-reply" : "echo")) return false;
      if (e.dport && p.dport !== e.dport) return false;
      return true;
    }

    // IKE + IPsec negotiation between r (out of iface) and the peer in map entry e
    negotiate(r, iface, e, pkt) {
      const local = r.ifaces[iface].ip;
      const P = Object.values(this.dev).find((d) => d.type === "router" && Object.values(d.ifaces).some((i) => i.ip === e.peer));
      if (!P) return { why: `No router answers at peer ${e.peer}.` };
      if (!this.lookup(r, e.peer)) return { why: `${r.hostname} has no route to the peer ${e.peer}.` };
      const pol = (d) => Object.values(d.isakmp).filter((p) => p.auth === "pre-share");
      const mine = pol(r), theirs = pol(P);
      if (!mine.length) return { why: `${r.hostname} has no ISAKMP policy with authentication pre-share.` };
      if (!theirs.length) return { why: `${P.hostname} has no ISAKMP policy with authentication pre-share.` };
      const ok = mine.some((a) => theirs.some((b) => a.enc === b.enc && a.hash === b.hash && a.group === b.group));
      if (!ok) return { why: `IKE phase 1 failed: the ISAKMP policies on ${r.hostname} and ${P.hostname} don't match (encryption, hash, group).` };
      if (!r.keys[e.peer]) return { why: `${r.hostname} has no pre-shared key for ${e.peer} (crypto isakmp key … address ${e.peer}).` };
      if (!P.keys[local]) return { why: `${P.hostname} has no pre-shared key for ${local} (crypto isakmp key … address ${local}).` };
      if (r.keys[e.peer] !== P.keys[local]) return { why: `The pre-shared keys don't match: ${r.hostname} uses "${r.keys[e.peer]}", ${P.hostname} uses "${P.keys[local]}".` };
      const pIf = Object.entries(P.ifaces).find(([, i]) => i.ip === e.peer);
      const pMap = pIf && pIf[1].cmap && P.cmaps[pIf[1].cmap];
      if (!pMap) return { why: `${P.hostname} has no crypto map applied on the interface with ${e.peer}.` };
      const pe = Object.values(pMap).find((x) => x.peer === local && x.ts && x.acl != null);
      if (!pe) return { why: `${P.hostname}'s crypto map has no complete entry (set peer ${local}, set transform-set, match address).` };
      const t1 = r.tsets[e.ts], t2 = P.tsets[pe.ts];
      if (!t1 || !t2) return { why: `A crypto map points to a transform-set that doesn't exist.` };
      if (t1.join(" ") !== t2.join(" ")) return { why: `IPsec phase 2 failed: the transform sets differ (${t1.join(" ")} vs ${t2.join(" ")}).` };
      const rev = { ...pkt, src: pkt.dst, dst: pkt.src, proto: "ip" };
      const pa = P.acls[pe.acl];
      if (!pa || !pa.entries.some((x) => x.action === "permit" && this.aclMatch(x, rev, pa.type))) return { why: `The crypto ACLs aren't mirror images: ${P.hostname}'s ACL ${pe.acl} doesn't cover the return traffic.` };
      const ra = r.acls[e.acl].entries.find((x) => x.action === "permit" && this.aclMatch(x, pkt, r.acls[e.acl].type));
      const mk = (local, peer, map, iface, ent, acl) => ({ local, peer, map, iface, ent, acl, encaps: 0, decaps: 0, spi: (0x10000000 + Math.floor(Math.random() * 0xefffffff)).toString(16).toUpperCase() });
      r.sa[e.peer] = mk(local, e.peer, r.ifaces[iface].cmap, iface, e, ra);
      P.sa[local] = mk(e.peer, local, pIf[1].cmap, pIf[0], pe, pa.entries.find((x) => x.action === "permit"));
      this.changed();
      return { ok: true };
    }

    // send one IPv4 packet from a device. Returns {ok, ttl, path} or {lost, why, unreach}
    send(fromId, pkt) {
      const d = this.dev[fromId];
      let path = [fromId];
      if (d.type === "pc") {
        if (!d.ip || !d.mask) return { lost: true, why: `${d.name} has no IPv4 address.` };
        if (pkt.dst === d.ip || pkt.dst.startsWith("127.")) return { ok: true, ttl: 128, path };
        let nh = same(pkt.dst, d.ip, d.mask) ? pkt.dst : null;
        if (!nh) {
          if (!d.gw) return { lost: true, why: `${pkt.dst} is in a different network than ${d.name} (${d.ip}/${plen(d.mask)}), and ${d.name} has no default gateway.` };
          if (!same(d.gw, d.ip, d.mask)) return { lost: true, why: `${d.name}'s default gateway ${d.gw} isn't in its own network.` };
          nh = d.gw;
        }
        if (!this.linkAt(d.id, d.port)) return { lost: true, why: `${d.name} isn't connected to anything.` };
        return this.hop(d, d.port, nh, { ...pkt, ttl: 128 }, path);
      }
      // router originates
      pkt = { ...pkt, ttl: 255 };
      if (Object.values(d.ifaces).some((i) => i.ip === pkt.dst && !i.shutdown)) return { ok: true, ttl: 255, path };
      const rt = this.lookup(d, pkt.dst);
      if (!rt) return { lost: true, why: `${d.hostname} has no route to ${pkt.dst}.` };
      if (!pkt.src) pkt.src = d.ifaces[rt.iface].ip;
      return this.egress(d, rt, pkt, path);
    }
    hop(d, port, nh, pkt, path, depth = 0) {
      if (depth > 12) return { lost: true, why: "Routing loop." };
      if (!this.upAt(d.id, port)) return { lost: true, why: `The link from ${d.hostname || d.name} ${shortIf(port)} is down.` };
      const a = this.arp(d, port, nh);
      if (a.fail) return { lost: true, why: `Nothing answered ARP for ${nh} on ${d.hostname || d.name}'s network: check addresses, cables and that the interface is up (no shutdown).` };
      const r = this.l2(d.id, port, this.macOn(d, port));
      const end = r.ends.find((e) => this.ipOn(this.dev[e.dev], e.port) === nh);
      if (!end) return { lost: true, why: `The frame to ${nh} didn't arrive (a switch port may be blocked).` };
      const legPath = this.pathTo(r.parent, end.dev);
      path = path.concat(legPath.slice(1));
      // hosts queue the packet while ARP resolves; routers drop it (the classic ".!!!!")
      if (a.miss && d.type === "router") return { lost: true, arp: true, why: "The first packet was dropped while the router resolved ARP. Ping again.", path };
      const T = this.dev[end.dev];
      if (T.type === "pc") return T.ip === pkt.dst ? { ok: true, ttl: pkt.ttl, path, at: T.id } : { lost: true, why: "Delivered to the wrong host.", path };
      return this.route(T, end.port, pkt, path, depth);
    }
    route(r, inIf, pkt, path, depth) {
      const I = r.ifaces[inIf];
      if (I.aclIn != null && !this.acl(r, I.aclIn, pkt)) return { lost: true, acl: true, why: `ACL ${I.aclIn} on ${r.hostname} ${shortIf(inIf)} (in) denied ${pkt.proto.toUpperCase()} ${pkt.src} → ${pkt.dst}.`, path };
      if (pkt.esp) {
        const sa = r.sa[pkt.src];
        if (!sa) return { lost: true, why: `${r.hostname} received ESP from ${pkt.src} without a security association.`, path };
        sa.decaps++;
        pkt = pkt.inner;
      }
      if (Object.values(r.ifaces).some((i) => i.ip === pkt.dst && !i.shutdown)) return { ok: true, ttl: pkt.ttl, path, at: r.id };
      pkt = { ...pkt, ttl: pkt.ttl - 1 };
      if (pkt.ttl <= 0) return { lost: true, why: "TTL expired.", path };
      const rt = this.lookup(r, pkt.dst);
      if (!rt) return { lost: true, unreach: I.ip, why: `${r.hostname} has no route to ${pkt.dst}: add a static route (ip route …).`, path };
      return this.egress(r, rt, pkt, path, depth);
    }
    egress(r, rt, pkt, path, depth = 0) {
      const E = r.ifaces[rt.iface];
      if (E.aclOut != null && !pkt.local && !this.acl(r, E.aclOut, pkt)) return { lost: true, acl: true, why: `ACL ${E.aclOut} on ${r.hostname} ${shortIf(rt.iface)} (out) denied the packet.`, path };
      let nh = rt.nh || pkt.dst;
      if (E.cmap && r.cmaps[E.cmap] && !pkt.esp) {
        const ents = Object.entries(r.cmaps[E.cmap]).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
        for (const e of ents) {
          if (!e.peer || !e.ts || e.acl == null || !r.acls[e.acl]) continue; // incomplete entry: ignored, traffic leaves in clear
          const a = r.acls[e.acl];
          if (!a.entries.some((x) => x.action === "permit" && this.aclMatch(x, { ...pkt, proto: pkt.proto }, a.type))) continue;
          let sa = r.sa[e.peer];
          if (!sa) {
            const n = this.negotiate(r, rt.iface, e, pkt);
            if (!n.ok) return { lost: true, why: n.why, path };
            this.lastNeg = true;
            return { lost: true, neg: true, why: "The first packets were used to negotiate the IPsec tunnel (IKE). Ping again.", path };
          }
          sa.encaps++;
          pkt = { src: E.ip, dst: e.peer, proto: "esp", esp: true, inner: pkt, ttl: pkt.ttl };
          const prt = this.lookup(r, e.peer);
          nh = prt.nh || e.peer;
          break;
        }
      }
      return this.hop(r, rt.iface, nh, pkt, path, depth + 1);
    }

    // full ping round trip: echo there, reply back
    echo(fromId, dst) {
      const d = this.dev[fromId];
      const src = d.type === "pc" ? d.ip : null;
      const go = this.send(fromId, { src, dst, proto: "icmp", kind: "echo" });
      if (!go.ok) { this.lastFail = go.why; this.event({ proto: "ICMP", src: src || "", dst, info: "Echo (ping) request — lost", path: go.path || [fromId] }); return { ...go, legs: [go.path || [fromId]] }; }
      this.event({ proto: "ICMP", src: src || "", dst, info: "Echo (ping) request", path: go.path });
      const back = go.at && go.at !== fromId ? this.send(go.at, { src: dst, dst: src || this.srcFor(d, dst), proto: "icmp", kind: "reply" }) : { ok: true, ttl: go.ttl, path: [fromId] };
      if (!back.ok) { this.lastFail = "The reply didn't come back: " + back.why; return { ...back, legs: [go.path, back.path || []] }; }
      this.event({ proto: "ICMP", src: dst, dst: src || "", info: "Echo (ping) reply", path: back.path });
      this.lastFail = "";
      return { ok: true, ttl: back.ttl, legs: [go.path, back.path] };
    }
    srcFor(r, dst) { const rt = this.lookup(r, dst); return rt ? r.ifaces[rt.iface].ip : ""; }
  }

  // ------------------------------------------------------------------ IOS command line
  const KW = (s) => s.split("|");
  function tokMatch(sp, t) {
    if (sp[0] === "<") {
      const ty = sp.slice(1, -1);
      if (ty === "ip") return isIp(t) ? t : null;
      if (ty === "num") return /^\d+$/.test(t) ? +t : null;
      if (ty === "word") return t;
      if (ty === "if") return canonIf(t);
      if (ty === "mac") return /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(t) ? t.toUpperCase() : null;
      return null;
    }
    const alts = KW(sp), lt = t.toLowerCase();
    if (alts.includes(lt)) return { kw: lt, exact: true };
    const pre = alts.filter((a) => a.startsWith(lt));
    if (pre.length === 1) return { kw: pre[0], exact: false };
    if (pre.length > 1) return { amb: true };
    return null;
  }
  function matchSpec(spec, toks) {
    const args = [];
    let i = 0, exact = 0;
    for (let s = 0; s < spec.length; s++) {
      let sp = spec[s];
      const opt = sp[0] === "[";
      if (opt) sp = sp.slice(1, -1);
      if (sp === "<rest>") { if (i >= toks.length && !opt) return { ok: false, inc: true, depth: i }; args.push(toks.slice(i)); i = toks.length; break; }
      if (i >= toks.length) { if (opt) { args.push(undefined); continue; } return { ok: false, inc: true, depth: i }; }
      const m = tokMatch(sp, toks[i]);
      if (m === null) { if (opt) { args.push(undefined); continue; } return { ok: false, depth: i }; }
      if (m && m.amb) return { ok: false, amb: true, depth: i };
      if (m && m.kw) { args.push(m.kw); exact += m.exact; } else args.push(m);
      i++;
    }
    if (i < toks.length) return { ok: false, depth: i };
    return { ok: true, args, exact, depth: i };
  }
  const MODE_PROMPT = { user: ">", priv: "#", config: "(config)#", if: "(config-if)#", isakmp: "(config-isakmp)#", cmap: "(config-crypto-map)#" };

  function ios(net, id, hooks = {}) {
    const say = (t, text, cls) => t.lines(text, cls);
    const D = () => net.dev[id];
    const cmds = [];
    // modes: list; spec: grammar; run(args, term)
    const C = (modes, spec, run, o = {}) => cmds.push({ modes: modes.split(" "), spec: spec.split(" "), run, ...o });
    const isR = () => D().type === "router", isS = () => D().type === "switch";
    const needLic = () => isR() && D().license;

    // ---------- exec modes
    C("user", "enable", () => (D().mode = "priv"));
    C("user priv", "exit|logout", (a, t) => { D().mode = "user"; t.print(""); t.print(`${D().hostname} con0 is now available`, "tl-dim"); t.print("Press RETURN to get started.", "tl-dim"); });
    C("priv", "disable", () => (D().mode = "user"));
    C("priv", "configure terminal", (a, t) => { D().mode = "config"; t.print("Enter configuration commands, one per line.  End with CNTL/Z."); });
    C("priv", "copy running-config startup-config", async (a, t) => {
      const r = await t.ask("Destination filename [startup-config]? ");
      if (r == null) return;
      t.print("Building configuration..."); await t.wait(400); D().startup = cfgOf(D()); t.print("[OK]"); net.changed();
    });
    C("priv", "write [memory]", async (a, t) => { t.print("Building configuration..."); await t.wait(400); D().startup = cfgOf(D()); t.print("[OK]"); net.changed(); });
    C("priv", "reload", async (a, t) => {
      const d = D();
      if (JSON.stringify(cfgOf(d)) !== JSON.stringify(d.startup)) {
        let s;
        for (;;) {
          s = await t.ask("System configuration has been modified. Save? [yes/no]: ");
          if (s == null) return;
          if (/^(y|n)/i.test(s.trim())) break;
          t.print("% Please answer 'yes' or 'no'.");
        }
        if (/^y/i.test(s)) { t.print("Building configuration..."); d.startup = cfgOf(d); t.print("[OK]"); }
      }
      const c = await t.ask("Proceed with reload? [confirm]");
      if (c == null || /^n/i.test(c)) return;
      t.print("");
      for (const l of ["System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)", "Initializing memory for ECC", "c2900 platform with 524288 Kbytes of main memory", "Readonly ROMMON initialized", "", `program load complete, entry point: 0x80803000, size: 0x1b340`, "#################################################", ""]) { t.print(l, "tl-dim"); if (!(await t.wait(110))) break; }
      restore(d);
      if (isR()) t.print(`Cisco ${d.model} (revision 1.0) with 491520K/32768K bytes of memory.`, "tl-dim");
      if (isR() && d.license) t.print("Technology Package License Information: securityk9 — Permanent", "tl-dim");
      t.print(""); t.print("Press RETURN to get started!", "tl-dim");
      d.mode = "user";
      net.settle(); hooks.reloaded?.(d);
    });
    function restore(d) {
      const fresh = isR() ? makeRouter(d.id, { mac: d.baseMac }) : makeSwitch(d.id, { mac: d.mac });
      for (const k of CFG_KEYS[d.type]) d[k] = fresh[k];
      if (d.startup) Object.assign(d, JSON.parse(JSON.stringify(d.startup)));
      if (isR()) { d.license = !!d.licNext; d.sa = {}; d.arp = {}; }
      else { for (const p of Object.values(d.ports)) Object.assign(p.ps, { err: false, count: 0, last: null }); d.macTable = {}; }
    }

    // ---------- show (exec)
    const show = (spec, run, o) => C("user priv", "show " + spec, run, o);
    show("running-config", (a, t) => say(t, runningConfig(D())), { priv: true });
    show("startup-config", (a, t) => say(t, D().startup ? runningConfig({ ...D(), ...JSON.parse(JSON.stringify(D().startup)) }).replace("Current configuration", "Using 1024 out of 262144 bytes\nCurrent configuration") : "startup-config is not present"), { priv: true });
    show("ip interface brief", (a, t) => say(t, ipBrief(D())));
    show("interfaces status", (a, t) => say(t, ifStatus(D())), { sw: true });
    show("port-security", (a, t) => say(t, psSummary(D())), { sw: true });
    show("port-security interface <if>", (a, t) => say(t, psIf(D(), a[3])), { sw: true });
    show("port-security address", (a, t) => say(t, psAddr(D())), { sw: true });
    show("mac address-table", (a, t) => say(t, macTable(D())), { sw: true });
    show("ip route", (a, t) => say(t, ipRoute(D())), { rt: true });
    show("access-lists [<num>]", (a, t) => say(t, showAcl(D(), a[2])), { rt: true });
    show("ip interface <if>", (a, t) => say(t, showIpIf(D(), a[3])), { rt: true });
    show("crypto isakmp sa", (a, t) => say(t, isakmpSa(D())), { rt: true, lic: true });
    show("crypto ipsec sa", (a, t) => say(t, ipsecSa(D())), { rt: true, lic: true });
    show("crypto map", (a, t) => say(t, cryptoMap(D())), { rt: true, lic: true });
    show("version", (a, t) => say(t, isR() ? `Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.1(4)M4\n...\nTechnology Package License Information for Module:'c2900'\n\nTechnology    Technology-package          Technology-package\n              Current       Type          Next reboot\n------------------------------------------------------------------\nipbase        ipbasek9      Permanent     ipbasek9\nsecurity      ${D().license ? "securityk9    Permanent    " : "None          None         "} ${D().licNext ? "securityk9" : "None"}\nuc            None          None          None\ndata          None          None          None` : "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4"));
    C("user priv", "ping <ip>", async (a, t) => {
      const d = D();
      if (isS()) { t.print("% Unrecognized host or address, or protocol not running."); return; }
      t.print("Type escape sequence to abort.");
      t.print(`Sending 5, 100-byte ICMP Echos to ${a[1]}, timeout is 2 seconds:`);
      const line = t.print("");
      let ok = 0;
      for (let k = 0; k < 5; k++) {
        const r = net.echo(d.id, a[1]);
        if (net.anim && r.legs) { await net.anim(r.legs[0], "icmp"); if (r.ok) await net.anim(r.legs[1], "icmp"); }
        if (!(await t.wait(r.ok ? 120 : 500))) break;
        line.textContent += r.ok ? "!" : r.unreach ? "U" : ".";
        if (r.ok) ok++;
      }
      t.print(`Success rate is ${ok * 20} percent (${ok}/5)${ok ? ", round-trip min/avg/max = 0/0/1 ms" : ""}`);
      hooks.pinged?.(d, a[1], ok);
    });

    // ---------- global config
    C("config", "hostname <word>", (a) => { D().hostname = a[1]; });
    C("config", "interface <if>", (a, t) => {
      const d = D(), n = a[1];
      if (!(isR() ? d.ifaces[n] : d.ports[n])) return t.print("%Invalid interface type and number");
      d.cur = n; d.mode = "if";
    });
    C("config", "access-list <num> <rest>", (a, t) => aclCmd(a[1], a[2], t), { rt: true });
    C("config", "no access-list <num>", (a) => { delete D().acls[a[2]]; net.changed(); }, { rt: true });
    C("config", "ip route <ip> <ip> <ip>", (a, t) => {
      if (!isMask(a[3])) return invalidAt(t, 3);
      const d = D();
      if (!d.routes.some((r) => r.net === a[2] && r.mask === a[3] && r.nh === a[4])) d.routes.push({ net: n2ip(netOf(a[2], a[3])), mask: a[3], nh: a[4] });
      net.changed();
    }, { rt: true });
    C("config", "no ip route <ip> <ip> <ip>", (a) => { const d = D(); d.routes = d.routes.filter((r) => !(r.net === a[3] && r.mask === a[4] && r.nh === a[5])); net.changed(); }, { rt: true });
    C("config", "license boot level securityk9|ipbasek9", (a, t) => licenseCmd(a[3], t), { rt: true });
    C("config", "license boot module c2900 technology-package securityk9", (a, t) => licenseCmd("securityk9", t), { rt: true });
    C("config", "crypto isakmp policy <num>", (a) => {
      const d = D();
      d.isakmp[a[3]] ??= { enc: "des", hash: "sha", auth: "rsa-sig", group: 1, life: 86400 };
      d.cur = a[3]; d.mode = "isakmp";
    }, { rt: true, lic: true });
    C("config", "crypto isakmp key <word> address <ip>", (a) => { D().keys[a[5]] = a[3]; net.changed(); }, { rt: true, lic: true });
    C("config", "crypto ipsec transform-set <word> <rest>", (a, t) => {
      const ok = ["esp-aes", "esp-des", "esp-3des", "esp-sha-hmac", "esp-md5-hmac", "ah-sha-hmac", "ah-md5-hmac", "esp-sha256-hmac", "esp-gcm"];
      const tr = a[4].map((x) => x.toLowerCase());
      const clean = [];
      for (let k = 0; k < tr.length; k++) {
        if (/^\d+$/.test(tr[k]) && clean.length && /aes|gcm/.test(clean[clean.length - 1])) { clean[clean.length - 1] += " " + tr[k]; continue; }
        if (!ok.includes(tr[k])) return invalidAt(t, 4 + k);
        clean.push(tr[k]);
      }
      D().tsets[a[3]] = clean; net.changed();
    }, { rt: true, lic: true });
    C("config", "crypto map <word> <num> ipsec-isakmp", (a, t) => {
      const d = D();
      d.cmaps[a[2]] ??= {};
      if (!d.cmaps[a[2]][a[3]]) {
        d.cmaps[a[2]][a[3]] = { peer: null, ts: null, acl: null };
        t.print("% NOTE: This new crypto map will remain disabled until a peer");
        t.print("        and a valid access list have been configured.");
      }
      d.cur = [a[2], a[3]]; d.mode = "cmap";
    }, { rt: true, lic: true });
    C("config if isakmp cmap", "end", (a, t) => { D().mode = "priv"; t.print(`%SYS-5-CONFIG_I: Configured from console by console`, "tl-dim"); });
    C("config", "exit", () => (D().mode = "priv"));
    C("if isakmp cmap", "exit", () => (D().mode = "config"));
    C("config if isakmp cmap", "do <rest>", async (a, t) => {
      const d = D(), m = d.mode;
      d.mode = "priv";
      await exec(a[1].join(" "), t, true);
      if (d.mode === "priv") d.mode = m;
    });

    // ---------- interface
    const P = () => (isR() ? D().ifaces[D().cur] : D().ports[D().cur]);
    C("if", "shutdown", () => { P().shutdown = true; net.settle(); });
    C("if", "no shutdown", () => {
      const p = P();
      p.shutdown = false;
      if (isS()) p.ps.err = false;
      net.settle();
    });
    C("if", "description <rest>", (a) => { P().desc = a[1].join(" "); });
    C("if", "switchport mode access|trunk", (a) => { P().mode = a[2]; net.changed(); }, { sw: true });
    C("if", "switchport port-security", (a, t) => {
      const p = P();
      if (p.mode !== "access") return t.print(`Command rejected: ${D().cur} is a dynamic port.`);
      p.ps.on = true; net.changed();
    }, { sw: true });
    C("if", "no switchport port-security", () => { P().ps.on = false; net.changed(); }, { sw: true });
    C("if", "switchport port-security maximum <num>", (a, t) => {
      if (a[3] < 1 || a[3] > 132) return invalidAt(t, 3);
      P().ps.max = a[3]; net.changed();
    }, { sw: true });
    C("if", "switchport port-security mac-address sticky", () => {
      const ps = P().ps; ps.sticky = true;
      ps.secure.forEach((s) => (s.type = "SecureSticky")); net.changed();
    }, { sw: true });
    C("if", "switchport port-security mac-address sticky <mac>", (a) => { const ps = P().ps; ps.sticky = true; if (!ps.secure.some((s) => s.mac === a[4])) ps.secure.push({ mac: a[4], type: "SecureSticky" }); net.changed(); }, { sw: true });
    C("if", "switchport port-security mac-address <mac>", (a) => { const ps = P().ps; if (!ps.secure.some((s) => s.mac === a[3])) ps.secure.push({ mac: a[3], type: "SecureConfigured" }); net.changed(); }, { sw: true });
    C("if", "switchport port-security violation protect|restrict|shutdown", (a) => { P().ps.violation = a[3]; net.changed(); }, { sw: true });
    C("if", "ip address <ip> <ip>", (a, t) => {
      if (!isMask(a[3])) return t.print("% Inconsistent address and mask") ;
      const d = D();
      const clash = Object.entries(d.ifaces).find(([n, i]) => n !== d.cur && i.ip && i.mask && same(i.ip, a[2], i.mask));
      if (clash) return t.print(`% ${n2ip(netOf(a[2], a[3]))} overlaps with ${clash[0]}`);
      Object.assign(P(), { ip: a[2], mask: a[3] }); net.changed();
    }, { rt: true });
    C("if", "no ip address", () => { Object.assign(P(), { ip: "", mask: "" }); net.changed(); }, { rt: true });
    C("if", "ip access-group <num> in|out", (a) => { P()[a[3] === "in" ? "aclIn" : "aclOut"] = a[2]; net.changed(); }, { rt: true });
    C("if", "no ip access-group <num> in|out", (a) => { P()[a[4] === "in" ? "aclIn" : "aclOut"] = null; net.changed(); }, { rt: true });
    C("if", "crypto map <word>", (a, t) => {
      P().cmap = a[2];
      if (!D().cmaps[a[2]]) return;
      t.print("*Jan  3 07:16:26.785: %CRYPTO-6-ISAKMP_ON_OFF: ISAKMP is ON", "tl-dim");
      net.changed();
    }, { rt: true, lic: true });
    C("if", "no crypto map", () => { P().cmap = null; net.changed(); }, { rt: true, lic: true });

    // ---------- isakmp policy
    const POL = () => D().isakmp[D().cur];
    C("isakmp", "encryption aes|des|3des [<num>]", (a, t) => {
      if (a[1] === "aes" && a[2] != null && ![128, 192, 256].includes(a[2])) return invalidAt(t, 2);
      POL().enc = a[1] + (a[1] === "aes" && a[2] ? " " + a[2] : ""); net.changed();
    });
    C("isakmp", "hash sha|md5|sha256", (a) => { POL().hash = a[1]; net.changed(); });
    C("isakmp", "authentication pre-share|rsa-sig", (a) => { POL().auth = a[1]; net.changed(); });
    C("isakmp", "group <num>", (a, t) => { if (![1, 2, 5, 14].includes(a[1])) return invalidAt(t, 1); POL().group = a[1]; net.changed(); });
    C("isakmp", "lifetime <num>", (a) => { POL().life = a[1]; });
    // ---------- crypto map entry
    const ENT = () => D().cmaps[D().cur[0]][D().cur[1]];
    C("cmap", "set peer <ip>", (a) => { ENT().peer = a[2]; net.changed(); });
    C("cmap", "set transform-set <word>", (a, t) => { if (!D().tsets[a[2]]) t.print(`ERROR: transform set with tag "${a[2]}" does not exist.`); else { ENT().ts = a[2]; net.changed(); } });
    C("cmap", "match address <num>", (a) => { ENT().acl = a[2]; net.changed(); });

    function licenseCmd(lvl, t) {
      return (async () => {
        if (lvl !== "securityk9") { D().licNext = false; return; }
        t.print("PLEASE  READ THE  FOLLOWING TERMS  CAREFULLY. INSTALLING THE LICENSE OR", "tl-dim");
        t.print("LICENSE  KEY  PROVIDED FOR  ANY CISCO  PRODUCT  FEATURE  OR  USING SUCH", "tl-dim");
        t.print("PRODUCT FEATURE CONSTITUTES YOUR FULL ACCEPTANCE OF THE FOLLOWING TERMS…", "tl-dim");
        const r = await t.ask("ACCEPT? [yes/no]: ");
        if (!r || !/^y/i.test(r)) return;
        D().licNext = true;
        t.print("% use 'write' command to make license boot config take effect on next boot");
        net.changed();
      })();
    }

    function aclCmd(num, rest, t) {
      const d = D();
      const std = num >= 1 && num <= 99, ext = num >= 100 && num <= 199;
      if (!std && !ext) return invalidAt(t, 1);
      const tk = rest.map((x) => x.toLowerCase());
      let i = 0;
      const base = 2;
      const action = tk[i];
      if (!["permit", "deny", "remark"].includes(action)) return tk.length ? invalidAt(t, base + i) : t.print("% Incomplete command.");
      if (action === "remark") return;
      i++;
      const addr = () => {
        if (tk[i] === "any") { i++; return { any: true }; }
        if (tk[i] === "host") { i++; if (!isIp(tk[i] || "")) return null; return { ip: tk[i++], wc: "0.0.0.0" }; }
        if (isIp(tk[i] || "")) {
          const ip = tk[i++];
          if (isIp(tk[i] || "")) return { ip, wc: tk[i++] };
          return std ? { ip, wc: "0.0.0.0" } : null;
        }
        return null;
      };
      const PORTS = { www: 80, http: 80, telnet: 23, ftp: 21, ssh: 22, domain: 53, smtp: 25, pop3: 110, https: 443 };
      const port = () => {
        if (tk[i] !== "eq") return null;
        i++;
        const p = /^\d+$/.test(tk[i] || "") ? +tk[i] : PORTS[tk[i]];
        if (!p) return undefined;
        i++;
        return p;
      };
      let e;
      if (std) {
        const src = addr();
        if (!src) return tk[i] == null ? t.print("% Incomplete command.") : invalidAt(t, base + i);
        e = { action, src };
      } else {
        const proto = tk[i];
        if (!["ip", "icmp", "tcp", "udp", "esp", "ahp", "gre"].includes(proto)) return proto == null ? t.print("% Incomplete command.") : invalidAt(t, base + i);
        i++;
        const src = addr();
        if (!src) return tk[i] == null ? t.print("% Incomplete command.") : invalidAt(t, base + i);
        let sport = (proto === "tcp" || proto === "udp") ? port() : null;
        if (sport === undefined) return invalidAt(t, base + i);
        const dst = addr();
        if (!dst) return tk[i] == null ? t.print("% Incomplete command.") : invalidAt(t, base + i);
        let dport = (proto === "tcp" || proto === "udp") ? port() : null;
        if (dport === undefined) return invalidAt(t, base + i);
        let icmp = null;
        if (proto === "icmp" && ["echo", "echo-reply"].includes(tk[i])) icmp = tk[i++];
        if (i < tk.length) return invalidAt(t, base + i);
        e = { action, proto, src, dst, sport, dport, icmp };
      }
      d.acls[num] ??= { type: std ? "standard" : "extended", entries: [] };
      e.seq = (d.acls[num].entries.length + 1) * 10;
      e.text = [action, std ? "" : e.proto, fmtA(e.src), e.sport ? "eq " + e.sport : "", std ? "" : fmtA(e.dst), e.dport ? "eq " + e.dport : "", e.icmp || ""].filter(Boolean).join(" ");
      d.acls[num].entries.push(e);
      net.changed();
    }
    const fmtA = (a) => (a.any ? "any" : a.wc === "0.0.0.0" ? "host " + a.ip : a.ip + " " + a.wc);

    // ---------- outputs
    function runningConfig(d) {
      const L = ["Building configuration...", "", "Current configuration : " + (900 + JSON.stringify(cfgOf(d)).length) + " bytes", "!", "version 15." + (d.type === "router" ? "1" : "0"), "no service timestamps log datetime msec", "no service timestamps debug datetime msec", "no service password-encryption", "!", "hostname " + d.hostname, "!"];
      if (d.type === "router") {
        if (d.licNext) L.push("license udi pid CISCO2911/K9 sn FTX152400KS", "license boot module c2900 technology-package securityk9", "!");
        for (const [n, p] of Object.entries(d.isakmp)) {
          L.push("crypto isakmp policy " + n);
          if (p.enc !== "des") L.push(" encr " + p.enc);
          if (p.hash !== "sha") L.push(" hash " + p.hash);
          if (p.auth !== "rsa-sig") L.push(" authentication " + p.auth);
          if (p.group !== 1) L.push(" group " + p.group);
          L.push("!");
        }
        for (const [peer, k] of Object.entries(d.keys)) L.push(`crypto isakmp key ${k} address ${peer}`);
        if (Object.keys(d.keys).length) L.push("!");
        for (const [n, ts] of Object.entries(d.tsets)) L.push(`crypto ipsec transform-set ${n} ${ts.join(" ")}`, "!");
        for (const [m, ents] of Object.entries(d.cmaps)) for (const [s, e] of Object.entries(ents)) {
          L.push(`crypto map ${m} ${s} ipsec-isakmp `);
          if (e.peer) L.push(" set peer " + e.peer);
          if (e.ts) L.push(" set transform-set " + e.ts + " ");
          if (e.acl != null) L.push(" match address " + e.acl);
          L.push("!");
        }
        for (const [n, i] of Object.entries(d.ifaces)) {
          L.push("interface " + n);
          if (i.desc) L.push(" description " + i.desc);
          L.push(i.ip ? ` ip address ${i.ip} ${i.mask}` : " no ip address");
          if (i.aclIn != null) L.push(` ip access-group ${i.aclIn} in`);
          if (i.aclOut != null) L.push(` ip access-group ${i.aclOut} out`);
          L.push(" duplex auto", " speed auto");
          if (i.shutdown) L.push(" shutdown");
          if (i.cmap) L.push(" crypto map " + i.cmap);
          L.push("!");
        }
        L.push("interface Vlan1", " no ip address", " shutdown", "!", "ip classless");
        for (const r of d.routes) L.push(`ip route ${r.net} ${r.mask} ${r.nh} `);
        L.push("!", "ip flow-export version 9", "!");
        for (const [n, a] of Object.entries(d.acls)) for (const e of a.entries) L.push(`access-list ${n} ${e.text}`);
        if (Object.keys(d.acls).length) L.push("!");
      } else {
        L.push("spanning-tree mode pvst", "spanning-tree extend system-id", "!");
        for (const [n, p] of Object.entries(d.ports)) {
          L.push("interface " + n);
          if (p.desc) L.push(" description " + p.desc);
          if (p.mode === "access") L.push(" switchport mode access");
          if (p.mode === "trunk") L.push(" switchport mode trunk");
          if (p.ps.on) L.push(" switchport port-security");
          if (p.ps.max !== 1) L.push(" switchport port-security maximum " + p.ps.max);
          if (p.ps.sticky) L.push(" switchport port-security mac-address sticky ");
          for (const s of p.ps.secure) if (s.type === "SecureSticky") L.push(" switchport port-security mac-address sticky " + s.mac);
          for (const s of p.ps.secure) if (s.type === "SecureConfigured") L.push(" switchport port-security mac-address " + s.mac);
          if (p.ps.violation !== "shutdown") L.push(" switchport port-security violation " + p.ps.violation);
          if (p.shutdown) L.push(" shutdown");
          L.push("!");
        }
        L.push("interface Vlan1", " no ip address", " shutdown", "!");
      }
      L.push("line con 0", "!", "line vty 0 4", " login", "!", "end");
      return L.join("\n");
    }
    const pad = (s, n) => String(s).padEnd(n);
    function ipBrief(d) {
      const L = ["Interface              IP-Address      OK? Method Status                Protocol "];
      const st = (adm, up) => adm ? ["administratively down", "down"] : up ? ["up", "up"] : ["down", "down"];
      if (d.type === "router") for (const [n, i] of Object.entries(d.ifaces)) {
        const [s, p] = st(i.shutdown, net.upAt(d.id, n));
        L.push(pad(n, 23) + pad(i.ip || "unassigned", 16) + "YES " + pad(i.ip ? "manual" : "unset", 7) + pad(s, 22) + p);
      } else for (const [n, p] of Object.entries(d.ports)) {
        const [s, pr] = p.ps.err ? ["down", "down"] : st(p.shutdown, net.upAt(d.id, n));
        L.push(pad(n, 23) + pad("unassigned", 16) + "YES manual " + pad(s, 22) + pr);
      }
      L.push(pad("Vlan1", 23) + pad("unassigned", 16) + "YES unset  administratively down down");
      return L.join("\n");
    }
    function ifStatus(d) {
      const L = ["Port      Name               Status       Vlan       Duplex  Speed Type"];
      for (const [n, p] of Object.entries(d.ports)) {
        const s = p.ps.err ? "err-disabled" : p.shutdown ? "disabled" : net.upAt(d.id, n) ? "connected" : "notconnect";
        L.push(pad(shortIf(n), 10) + pad(p.desc, 19) + pad(s, 13) + pad(p.mode === "trunk" ? "trunk" : "1", 11) + pad("auto", 8) + pad("auto", 6) + (n.startsWith("Gi") ? "10/100/1000BaseTX" : "10/100BaseTX"));
      }
      return L.join("\n");
    }
    function psStatus(d, n) { const p = d.ports[n]; return !p.ps.on ? "Secure-down" : p.ps.err ? "Secure-shutdown" : net.upAt(d.id, n) ? "Secure-up" : "Secure-down"; }
    function psIf(d, n) {
      const p = d.ports[n];
      if (!p) return "%Invalid interface type and number";
      const ps = p.ps;
      const cap = (s) => s[0].toUpperCase() + s.slice(1);
      return [
        `Port Security              : ${ps.on ? "Enabled" : "Disabled"}`,
        `Port Status                : ${psStatus(d, n)}`,
        `Violation Mode             : ${cap(ps.violation)}`,
        `Aging Time                 : 0 mins`, `Aging Type                 : Absolute`, `SecureStatic Address Aging : Disabled`,
        `Maximum MAC Addresses      : ${ps.max}`,
        `Total MAC Addresses        : ${ps.secure.length}`,
        `Configured MAC Addresses   : ${ps.secure.filter((s) => s.type === "SecureConfigured").length}`,
        `Sticky MAC Addresses       : ${ps.secure.filter((s) => s.type === "SecureSticky").length}`,
        `Last Source Address:Vlan   : ${ps.last ? ps.last + ":1" : "0000.0000.0000:0"}`,
        `Security Violation Count   : ${ps.count}`,
      ].join("\n");
    }
    function psSummary(d) {
      const L = ["Secure Port MaxSecureAddr CurrentAddr SecurityViolation Security Action", "               (Count)       (Count)        (Count)", "--------------------------------------------------------------------"];
      for (const [n, p] of Object.entries(d.ports)) if (p.ps.on) L.push(pad(shortIf(n), 13).padStart(13) + pad(p.ps.max, 14).padStart(9) + "    " + pad(p.ps.secure.length, 18) + pad(p.ps.count, 10) + p.ps.violation[0].toUpperCase() + p.ps.violation.slice(1));
      L.push("----------------------------------------------------------------------");
      return L.join("\n");
    }
    function psAddr(d) {
      const L = ["               Secure Mac Address Table", "-----------------------------------------------------------------------------", "Vlan    Mac Address       Type                          Ports   Remaining Age", "                                                                   (mins)", "----    -----------       ----                          -----   -------------"];
      for (const [n, p] of Object.entries(d.ports)) for (const s of p.ps.secure) L.push(`   1    ${pad(s.mac, 18)}${pad(s.type, 30)}${pad(shortIf(n), 8)}  -`);
      L.push("-----------------------------------------------------------------------------", "Total Addresses in System (excluding one mac per port)     : 0", "Max Addresses limit in System (excluding one mac per port) : 1024");
      return L.join("\n");
    }
    function macTable(d) {
      const L = ["          Mac Address Table", "-------------------------------------------", "", "Vlan    Mac Address       Type        Ports", "----    -----------       --------    -----", ""];
      for (const [m, p] of Object.entries(d.macTable)) {
        const sec = d.ports[p].ps.secure.some((s) => s.mac === m);
        L.push(`   1    ${pad(m.toLowerCase(), 18)}${pad(sec ? "STATIC" : "DYNAMIC", 12)}${shortIf(p)}`);
      }
      return L.join("\n");
    }
    function ipRoute(d) {
      const L = ["Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP", "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area", "       * - candidate default, U - per-user static route, o - ODR", "", "Gateway of last resort is not set", ""];
      for (const r of net.routes(d).sort((a, b) => ip2n(a.net) - ip2n(b.net))) {
        if (r.code === "C") { L.push(`C       ${r.net}/${plen(r.mask)} is directly connected, ${r.iface}`); L.push(`L       ${r.ip}/32 is directly connected, ${r.iface}`); }
        else L.push(`S       ${r.net}/${plen(r.mask)} [1/0] via ${r.nh}`);
      }
      return L.join("\n");
    }
    function showAcl(d, num) {
      const L = [];
      for (const [n, a] of Object.entries(d.acls)) {
        if (num != null && +n !== num) continue;
        L.push(`${a.type === "standard" ? "Standard" : "Extended"} IP access list ${n}`);
        for (const e of a.entries) L.push(`    ${e.seq} ${e.text}${e.hits ? ` (${e.hits} match(es))` : ""}`);
      }
      return L.join("\n");
    }
    function showIpIf(d, n) {
      const i = d.ifaces[n];
      if (!i) return "%Invalid interface type and number";
      const up = net.upAt(d.id, n);
      return [`${n} is ${i.shutdown ? "administratively down" : up ? "up" : "down"}, line protocol is ${up ? "up" : "down"}`,
        i.ip ? `  Internet address is ${i.ip}/${plen(i.mask)}` : "  Internet protocol processing disabled",
        `  Broadcast address is 255.255.255.255`, `  MTU is 1500 bytes`, `  Helper address is not set`, `  Directed broadcast forwarding is disabled`,
        `  Outgoing access list is ${i.aclOut != null ? i.aclOut : "not set"}`, `  Inbound  access list is ${i.aclIn != null ? i.aclIn : "not set"}`,
        `  Proxy ARP is enabled`, `  Security level is default`, `  Split horizon is enabled`, `  ICMP redirects are always sent`].join("\n");
    }
    function isakmpSa(d) {
      const L = ["IPv4 Crypto ISAKMP SA", "dst             src             state          conn-id slot status", ""];
      for (const s of Object.values(d.sa)) L.push(pad(s.peer, 16) + pad(s.local, 16) + pad("QM_IDLE", 18) + pad("1001", 8) + pad("0", 5) + "ACTIVE");
      L.push("", "IPv6 Crypto ISAKMP SA");
      return L.join("\n");
    }
    function ipsecSa(d) {
      const L = [];
      for (const [n, i] of Object.entries(d.ifaces)) {
        if (!i.cmap) continue;
        L.push("", `interface: ${n}`, `    Crypto map tag: ${i.cmap}, local addr ${i.ip}`, "", "   protected vrf: (none)");
        const sas = Object.values(d.sa).filter((s) => s.iface === n);
        const ents = Object.values(d.cmaps[i.cmap] || {});
        if (!sas.length) for (const e of ents) if (e.acl != null && d.acls[e.acl]) {
          const a = d.acls[e.acl].entries.find((x) => x.action === "permit");
          if (a) L.push(`   local  ident (addr/mask/prot/port): (${a.src.ip || "0.0.0.0"}/${a.src.wc ? n2ip(~ip2n(a.src.wc) >>> 0) : "0.0.0.0"}/0/0)`, `   remote ident (addr/mask/prot/port): (${a.dst.ip || "0.0.0.0"}/${a.dst.wc ? n2ip(~ip2n(a.dst.wc) >>> 0) : "0.0.0.0"}/0/0)`, `   current_peer ${e.peer || "0.0.0.0"} port 500`, "    PERMIT, flags={origin_is_acl,}", "   #pkts encaps: 0, #pkts encrypt: 0, #pkts digest: 0", "   #pkts decaps: 0, #pkts decrypt: 0, #pkts verify: 0", "   #pkts compressed: 0, #pkts decompressed: 0", "   #send errors 0, #recv errors 0", "", `     local crypto endpt.: ${i.ip}, remote crypto endpt.:${e.peer || "0.0.0.0"}`, "     current outbound spi: 0x0(0)");
        }
        for (const s of sas) {
          const a = s.acl;
          const m = (x) => (x.any ? "0.0.0.0/0.0.0.0" : `${x.ip}/${n2ip(~ip2n(x.wc) >>> 0)}`);
          L.push(`   local  ident (addr/mask/prot/port): (${a ? m(a.src) : ""}/0/0)`, `   remote ident (addr/mask/prot/port): (${a ? m(a.dst) : ""}/0/0)`, `   current_peer ${s.peer} port 500`, "    PERMIT, flags={origin_is_acl,}",
            `   #pkts encaps: ${s.encaps}, #pkts encrypt: ${s.encaps}, #pkts digest: 0`, `   #pkts decaps: ${s.decaps}, #pkts decrypt: ${s.decaps}, #pkts verify: 0`, "   #pkts compressed: 0, #pkts decompressed: 0", "   #pkts not compressed: 0, #pkts compr. failed: 0", "   #pkts not decompressed: 0, #pkts decompress failed: 0", "   #send errors 1, #recv errors 0", "",
            `     local crypto endpt.: ${s.local}, remote crypto endpt.:${s.peer}`, `     path mtu 1500, ip mtu 1500, ip mtu idb ${n}`, `     current outbound spi: 0x${s.spi}(${parseInt(s.spi, 16)})`, "", "     inbound esp sas:", `      spi: 0x${s.spi.split("").reverse().join("")}`, `        transform: ${(d.tsets[s.ent.ts] || []).join(" ")} ,`, "        in use settings ={Tunnel, }", "        sa timing: remaining key lifetime (k/sec): (4525504/3593)", "        IV size: 16 bytes", "        replay detection support: N", "        Status: ACTIVE", "", "     outbound esp sas:", `      spi: 0x${s.spi}`, `        transform: ${(d.tsets[s.ent.ts] || []).join(" ")} ,`, "        in use settings ={Tunnel, }", "        Status: ACTIVE");
        }
      }
      return L.length ? L.join("\n") : "There are no ipsec sas";
    }
    function cryptoMap(d) {
      const L = [];
      for (const [m, ents] of Object.entries(d.cmaps)) for (const [s, e] of Object.entries(ents)) {
        L.push(`Crypto Map ${m} ${s} ipsec-isakmp`, `        Peer = ${e.peer || ""}`);
        if (e.acl != null) { L.push(`        Extended IP access list ${e.acl}`); for (const x of d.acls[e.acl]?.entries || []) L.push(`            access-list ${e.acl} ${x.text}`); }
        L.push(`        Current peer: ${e.peer || ""}`, "        Security association lifetime: 4608000 kilobytes/3600 seconds", "        PFS (Y/N): N", `        Transform sets={`, `                ${e.ts || ""}, `, "        }");
        const ifs = Object.entries(d.ifaces).filter(([, i]) => i.cmap === m).map(([n]) => n);
        L.push(`        Interfaces using crypto map ${m}:`, ...ifs.map((n) => "                " + n), "");
      }
      return L.join("\n");
    }
    function invalidAt(t, idx, line) {
      const ln = line ?? t._line ?? "";
      const re = /\S+/g;
      let m, k = 0, off = ln.length;
      while ((m = re.exec(ln))) { if (k === idx) { off = m.index; break; } k++; }
      t.print(" ".repeat(t.o.prompt().length + off) + "^");
      t.print("% Invalid input detected at '^' marker.");
      t.print("");
    }

    function available(d) {
      return cmds.filter((c) => c.modes.includes(d.mode) && (!c.rt || d.type === "router") && (!c.sw || d.type === "switch") && (!c.lic || d.license) && (!c.priv || d.mode !== "user"));
    }
    async function exec(line, t, nested) {
      const d = D();
      if (!nested) t._line = line;
      const toks = tokenize(line);
      if (!toks.length) return;
      let pool = available(d);
      let results = pool.map((c) => ({ c, m: matchSpec(c.spec, toks) }));
      let ok = results.filter((r) => r.m.ok);
      // global commands are allowed from sub-modes (IOS falls back to the parent mode)
      if (!ok.length && ["if", "isakmp", "cmap"].includes(d.mode)) {
        const saved = d.mode;
        d.mode = "config";
        const r2 = available(d).map((c) => ({ c, m: matchSpec(c.spec, toks) })).filter((r) => r.m.ok && r.c.spec[0] !== "exit" && r.c.spec[0] !== "end");
        if (r2.length) { ok = r2; results = r2; } else d.mode = saved;
      }
      if (ok.length > 1) {
        const best = Math.max(...ok.map((r) => r.m.exact));
        const top = ok.filter((r) => r.m.exact === best);
        if (top.length > 1 && new Set(top.map((r) => r.c.spec.length)).size === top.length) ok = [top.sort((a, b) => a.c.spec.length - b.c.spec.length)[0]];
        else if (top.length > 1) { t.print(`% Ambiguous command: "${line.trim()}"`); return; }
        else ok = top;
      }
      if (ok.length === 1) { await ok[0].c.run(ok[0].m.args, t); return; }
      if (results.some((r) => r.m.amb)) { t.print(`% Ambiguous command: "${line.trim()}"`); return; }
      const inc = results.filter((r) => r.m.inc && r.m.depth === toks.length);
      if (inc.length) { t.print("% Incomplete command."); t.print(""); return; }
      if (toks.length === 1 && (d.mode === "user" || d.mode === "priv")) {
        t.print("Translating \"" + toks[0] + "\"...domain server (255.255.255.255)", "tl-dim");
        t.print("% Unknown command or computer name, or unable to find computer address");
        return;
      }
      const depth = Math.max(0, ...results.map((r) => r.m.depth));
      invalidAt(t, depth, line);
    }

    function help(partial) {
      const d = D();
      const toks = tokenize(partial);
      const ends = /\s$/.test(partial) || !partial;
      const done = ends ? toks : toks.slice(0, -1);
      const last = ends ? "" : (toks[toks.length - 1] || "").toLowerCase();
      const opts = new Set();
      for (const c of available(d)) {
        const m = matchSpec(c.spec.slice(0, done.length), done);
        if (!m.ok || c.spec.length <= done.length) continue;
        let sp = c.spec[done.length];
        if (sp[0] === "[") sp = sp.slice(1, -1);
        if (sp[0] === "<") { if (!last) opts.add(sp.replace("<if>", "<interface>").replace("<num>", "<number>").replace("<ip>", "A.B.C.D").replace("<word>", "WORD").replace("<mac>", "H.H.H").replace("<rest>", "LINE")); continue; }
        for (const k of KW(sp)) if (k.startsWith(last)) opts.add(k);
      }
      if (!opts.size) return "% Unrecognized command";
      return [...opts].sort().map((o) => "  " + o).join("\n");
    }
    function complete(partial) {
      if (/\s$/.test(partial) || !partial) return partial;
      const toks = tokenize(partial);
      const last = toks[toks.length - 1].toLowerCase();
      const opts = new Set();
      for (const c of available(D())) {
        const m = matchSpec(c.spec.slice(0, toks.length - 1), toks.slice(0, -1));
        if (!m.ok || c.spec.length < toks.length) continue;
        let sp = c.spec[toks.length - 1];
        if (sp[0] === "[") sp = sp.slice(1, -1);
        if (sp[0] !== "<") for (const k of KW(sp)) if (k.startsWith(last)) opts.add(k);
      }
      if (opts.size !== 1) return partial;
      return partial.replace(/\S+$/, [...opts][0] + " ");
    }
    const prompt = () => { const d = D(); return d.hostname + MODE_PROMPT[d.mode]; };
    const ctrlZ = (t) => { const d = D(); if (!["user", "priv"].includes(d.mode)) { d.mode = "priv"; t.print("^Z"); t.print("%SYS-5-CONFIG_I: Configured from console by console", "tl-dim"); } };
    const term = new Lab.Term({ prompt, exec: (l, t) => exec(l, t), help, complete, ctrlZ, label: "IOS command line", theme: "ios", after: hooks.after,
      banner: D().type === "router" ? "Press RETURN to get started!" : "Press RETURN to get started!" });
    return term;
  }

  // ------------------------------------------------------------------ PC command prompt
  function pcPrompt(net, id, hooks = {}) {
    const P = () => net.dev[id];
    const fmtIp = (s) => s || "0.0.0.0";
    async function ping(t, dst, n = 4) {
      const pc = P();
      if (!isIp(dst)) { t.print("Ping request could not find host " + dst + ". Please check the name and try again."); return; }
      t.print(""); t.print(`Pinging ${dst} with 32 bytes of data:`); t.print("");
      let rec = 0, sent = 0;
      for (let k = 0; k < n; k++) {
        sent++;
        const r = net.echo(pc.id, dst);
        if (net.anim && r.legs && r.legs[0].length > 1) { await net.anim(r.legs[0], "icmp"); if (r.ok) await net.anim(r.legs[1], "icmp"); }
        if (!(await t.wait(r.ok ? 250 : 900))) { sent--; break; }
        if (r.ok) { rec++; t.print(`Reply from ${dst}: bytes=32 time${dst.startsWith("127.") || dst === pc.ip ? "<1ms" : "<1ms"} TTL=${r.ttl}`); }
        else if (r.unreach) t.print(`Reply from ${r.unreach}: Destination host unreachable.`);
        else t.print("Request timed out.");
      }
      t.print(""); t.print(`Ping statistics for ${dst}:`);
      t.print(`    Packets: Sent = ${sent}, Received = ${rec}, Lost = ${sent - rec} (${sent ? Math.round(((sent - rec) / sent) * 100) : 0}% loss),`);
      if (rec) { t.print("Approximate round trip times in milli-seconds:"); t.print("    Minimum = 0ms, Maximum = 0ms, Average = 0ms"); }
      if (t.abort) t.print("Control-C");
      hooks.pinged?.(pc, dst, rec, sent);
    }
    async function exec(line, t) {
      const pc = P();
      const a = line.trim().split(/\s+/);
      const c = (a[0] || "").toLowerCase();
      if (!c) return;
      if (c === "ping") {
        let n = 4, dst = null;
        for (let i = 1; i < a.length; i++) { if (a[i] === "-n") n = Math.min(20, +a[++i] || 4); else if (a[i] === "-t") n = 20; else dst = a[i]; }
        if (!dst) { t.print("Usage: ping [-n count] [-t] target_name"); return; }
        return ping(t, dst, n);
      }
      if (c === "ipconfig") {
        const all = (a[1] || "").toLowerCase() === "/all";
        t.print(""); t.print("FastEthernet0 Connection:(default port)"); t.print("");
        if (all) { t.print(`   Connection-specific DNS Suffix..: `); t.print(`   Physical Address................: ${pc.mac}`); }
        else t.print(`   Connection-specific DNS Suffix..: `);
        t.print(`   Link-local IPv6 Address.........: FE80::${pc.mac.replace(/\./g, "").slice(4, 8)}:${pc.mac.replace(/\./g, "").slice(8)}`);
        t.print(`   IPv4 Address....................: ${fmtIp(pc.ip)}`);
        t.print(`   Subnet Mask.....................: ${fmtIp(pc.mask)}`);
        t.print(`   Default Gateway.................: ${fmtIp(pc.gw)}`);
        if (all) { t.print(`   DHCP Servers....................: 0.0.0.0`); t.print(`   DNS Servers.....................: 0.0.0.0`); t.print(`   Host Name.......................: ${pc.name}`); }
        t.print("");
        hooks.ran?.("ipconfig" + (all ? " /all" : ""));
        return;
      }
      if (c === "arp") {
        const f = (a[1] || "").toLowerCase();
        if (f === "-a") {
          const ents = Object.entries(pc.arp);
          if (!ents.length) t.print("No ARP Entries Found");
          else { t.print("  Internet Address      Physical Address      Type"); for (const [ip, mac] of ents) t.print(`  ${pad(ip, 22)}${pad(mac.toLowerCase(), 22)}dynamic`); }
          hooks.ran?.("arp -a");
          return;
        }
        if (f === "-d") { pc.arp = {}; hooks.ran?.("arp -d"); return; }
        t.print("ARP -a | -d"); return;
      }
      if (c === "hostname") { t.print(pc.name); hooks.ran?.("hostname"); return; }
      if (c === "netstat") {
        t.print(""); t.print("Active Connections"); t.print("");
        t.print("  Proto  Local Address          Foreign Address        State           PID");
        t.print("  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012");
        t.print("  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4");
        t.print(`  TCP    ${fmtIp(pc.ip)}:139       0.0.0.0:0              LISTENING       4`);
        hooks.ran?.("netstat");
        return;
      }
      if (c === "cls") { t.out.textContent = ""; return; }
      if (c === "help" || c === "?") { t.lines("Available Commands:\n?         Display the list of available commands\narp       Display the arp table\nipconfig  Display network configuration\nping      Send echo messages\nhostname  Show the computer name\nnetstat   Show active connections\ncls       Clear the screen"); return; }
      t.print("Invalid Command.");
    }
    const pad = (s, n) => String(s).padEnd(n);
    return new Lab.Term({ prompt: () => "C:\\>", exec, label: "Command Prompt", theme: "cmd", banner: "Packet Tracer PC Command Line 1.0", after: hooks.after });
  }

  // IP configuration form, like Packet Tracer's Desktop > IP Configuration
  function ipForm(net, id, onChange) {
    const pc = net.dev[id];
    const f = (label, key, ph) => {
      const inp = h("input", { type: "text", inputmode: "decimal", value: pc[key], placeholder: ph, autocomplete: "off", spellcheck: "false" });
      const msg = h("small", { class: "ipf-msg" });
      const apply = () => {
        const v = inp.value.trim();
        if (v && !(key === "mask" ? isMask(v) : isIp(v))) { msg.textContent = key === "mask" ? "Not a valid subnet mask" : "Not a valid IPv4 address"; inp.classList.add("is-bad"); return; }
        msg.textContent = ""; inp.classList.remove("is-bad");
        if (pc[key] !== v) { pc[key] = v; if (key === "ip" && v && !pc.mask) { pc.mask = "255.255.255.0"; mask.value = pc.mask; } pc.arp = {}; net.changed(); onChange?.(); }
      };
      inp.addEventListener("change", apply);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); inp.blur(); } });
      const row = h("label", { class: "ipf-row" }, h("span", null, label), inp, msg);
      row.inp = inp;
      return row;
    };
    const ip = f("IPv4 Address", "ip", "0.0.0.0"), mask = f("Subnet Mask", "mask", "0.0.0.0").inp, gw = f("Default Gateway", "gw", "0.0.0.0");
    return h("div", { class: "ipf" }, h("p", { class: "ipf-k" }, "Desktop › IP Configuration · Static"), ip, mask.parentElement, gw, h("p", { class: "ipf-note" }, "Values apply when you leave the box or press Enter. Leave Default Gateway empty when no router is used."));
  }

  // a PC panel: IP Configuration + Command Prompt
  function pcPanel(net, id, term, onChange) {
    const ipf = ipForm(net, id, onChange);
    const tabs = h("div", { class: "seg" });
    const body = h("div");
    const views = { ip: ipf, cmd: term.el };
    const set = (k) => { for (const b of tabs.children) b.setAttribute("aria-pressed", b.dataset.k === k); body.replaceChildren(views[k]); if (k === "cmd") term.out.scrollTop = term.out.scrollHeight; };
    tabs.append(h("button", { type: "button", "data-k": "ip", onclick: () => set("ip") }, "IP Configuration"), h("button", { type: "button", "data-k": "cmd", onclick: () => set("cmd") }, "Command Prompt"));
    set("cmd");
    const el = h("div", { class: "pcpanel" }, tabs, body);
    el.setView = set;
    return el;
  }

  // the next command a student still needs to reach a router plan (for "Type it for me")
  // plan = { hostname, ifs: [[name, ip, mask]], routes: [[net, mask, nh]] }
  function nextRouter(r, plan) {
    const ifOk = ([n, ip, mask]) => r.ifaces[n].ip === ip && r.ifaces[n].mask === mask && !r.ifaces[n].shutdown;
    const routeOk = ([nt, m, nh]) => r.routes.some((x) => x.net === nt && x.mask === m && x.nh === nh);
    const todo = (plan.hostname && r.hostname !== plan.hostname) || plan.ifs.some((i) => !ifOk(i)) || (plan.routes || []).some((x) => !routeOk(x));
    if (r.mode === "user") return "enable";
    if (r.mode === "priv") return todo ? "configure terminal" : "show ip interface brief";
    if (plan.hostname && r.hostname !== plan.hostname) return "hostname " + plan.hostname;
    for (const i of plan.ifs) {
      if (ifOk(i)) continue;
      const [n, ip, mask] = i, I = r.ifaces[n];
      if (r.mode === "if" && r.cur === n) return I.ip !== ip || I.mask !== mask ? `ip address ${ip} ${mask}` : "no shutdown";
      return "interface " + n.replace("GigabitEthernet", "g");
    }
    for (const x of plan.routes || []) if (!routeOk(x)) return `ip route ${x[0]} ${x[1]} ${x[2]}`;
    return "end";
  }

  window.Net = { nextRouter, Network, ios, pcPrompt, pcPanel, ipForm, isIp, isMask, same, canonIf, shortIf, cmdMatch: Lab.cmdMatch };
})();
