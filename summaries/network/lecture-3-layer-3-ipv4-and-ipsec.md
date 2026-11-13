# الآي بي والتشفير في زمن التزوير
## Lecture 3 — Layer 3: IPv4 and IPsec Security and Protection

**Layer 3 (Network layer)** : moves packets **between networks**. IPv4 delivers packets; ACLs, filtering and IPsec add security.

**IPv4** : a **connectionless** network-layer protocol with **32-bit** addresses written in dotted decimal (192.168.10.25).

> Routers forward mainly by the **destination** address. The **source** address is only a claim — not strong proof of identity.

Q/ What are the IPv4 header fields and their role ?

| Field | Role |
|---|---|
| Version | Always 4 for IPv4 |
| IHL | Header length (where data begins) |
| DSCP/ECN | Priority / quality of service |
| Total Length | Header + data size |
| Identification, Flags, Fragment Offset | Fragmentation and reassembly |
| **TTL** | Decreases by 1 at each router; at 0 the packet is discarded (prevents endless loops) |
| Protocol | Upper layer: ICMP, TCP, UDP, **ESP**, **AH** |
| Header Checksum | Detects errors in the header |
| Source / Destination | Claimed sender (32 bits) / intended receiver (32 bits) |

Q/ Why does IPv4 need extra security ?
- It was designed for **delivery** only: it doesn't encrypt contents or strongly authenticate the source address.

---

## IPv4 threats

| Threat | What can happen |
|---|---|
| **IP spoofing** | A false source address is placed in a packet |
| Packet interception | Unencrypted data read on an untrusted path |
| ICMP abuse | Ping sweeps, reconnaissance, floods, false control messages |
| DoS / DDoS | Bandwidth, router or server resources exhausted |
| Fragmentation attacks | Odd fragments confuse filters or consume reassembly resources |
| Routing attacks | Traffic redirected, dropped or intercepted |

**IP spoofing** : faking the source IPv4 address to **hide the sender, imitate another device, bypass IP-based restrictions, or support DoS**.

**ICMP** : diagnostics and error reporting — ping uses **Echo Request / Echo Reply**; traceroute also depends on ICMP.

| Topic | Explanation | Protection |
|---|---|---|
| Ping sweep | ICMP to many addresses to find live hosts | Permit only required ICMP, rate-limit, log |
| DoS / DDoS | Floods make a service unavailable | Filtering, rate limiting, monitoring, upstream protection |
| Fragmentation | Tiny/overlapping/incomplete fragments confuse devices | Drop malformed fragments, reassemble/inspect, update |

> **Don't blindly block all ICMP** — some messages are needed for diagnostics and correct operation.

Q/ How are routers protected against routing attacks ?
- Strong admin authentication, **SSH**, restricted management addresses, **routing-protocol authentication**, updates, backups, logging, disabling unnecessary services.

---

## Protection mechanisms

**ACL (Access Control List)** : an **ordered** set of permit/deny rules checking source, destination, protocol, port or ICMP type.

| Standard ACL | Extended ACL |
|---|---|
| Mainly checks the **source** IPv4 address | Checks **source, destination, protocol and TCP/UDP port** |
| e.g. permit 192.168.10.0/24 | e.g. permit HTTPS from 192.168.20.0/24 to 172.16.10.10 |

Q/ What are the ACL processing principles ?
1. Rules are checked **in order**.
2. The **first matching rule** is applied.
3. **Specific rules before general** rules.
4. Permit only required traffic; test before deployment.

**Ingress filtering** : checks traffic **entering** the network; rejects impossible or suspicious source addresses.
**Egress filtering** : checks traffic **leaving**; stops internal systems from using unauthorized source addresses.
**uRPF (Unicast Reverse Path Forwarding)** : accepts a packet only if its source is reachable through the **expected return path**.
**Network segmentation** : separates students, staff, administration, servers and management networks.

> No single Layer 3 control stops every attack — combine them.

---

## IPsec

**IPsec** : protects IP communication **at the network layer**, useful across untrusted networks like the Internet. Adds encryption, integrity, authentication and **anti-replay**.

| Component | Main role |
|---|---|
| **AH** (Authentication Header) | Integrity, data-origin authentication, anti-replay — **no confidentiality** |
| **ESP** (Encapsulating Security Payload) | **Encryption** (confidentiality) + integrity, authentication, anti-replay |
| **SA** (Security Association) | How traffic is protected: algorithms, keys, peer, lifetime, **SPI**, anti-replay info |
| **IKEv2** | Authenticates peers, negotiates parameters, establishes keys, creates/manages SAs |

| Feature | AH | ESP |
|---|---|---|
| Confidentiality | **No** | **Yes** |
| Integrity | Yes | Yes (when configured) |
| Source authentication | Yes | Yes (when configured) |
| Anti-replay | Yes | Yes |
| VPN use | Limited | **Commonly used** |

| Feature | Transport mode | Tunnel mode |
|---|---|---|
| Protects | Mainly the original **payload** | The **entire original packet** |
| IP header | Original header stays visible | A **new outer IP header** is added |
| Typical use | Host-to-host | **Gateway-to-gateway, site-to-site VPN**, remote access |
| Overhead | Lower | Higher |

> Two university buildings linked over the Internet → **tunnel mode** (with ESP).

**Security Association (SA)** : a **one-directional** logical agreement — two-way traffic needs **one SA in each direction**.

Q/ What does IKEv2 do ?
1. Authenticates the two peers.
2. Negotiates security algorithms and parameters.
3. Establishes keys and creates IPsec SAs.
4. Maintains the relationship and re-keys when needed.

Q/ Site-to-site example (192.168.10.0/24 ↔ 192.168.20.0/24) — what do the gateways do ?
- Identify protected traffic → authenticate each other → establish SAs → encrypt packets → decrypt at the other site.

---

| Requirement | Recommended protection |
|---|---|
| Students must not access router management | Management ACL + segmentation |
| Internet packet claims an internal source | Ingress filtering + uRPF |
| Only required traffic to the grade server | Extended ACL |
| Two buildings exchange private data over the Internet | IPsec tunnel mode |
| Suspicious ICMP traffic | Rate limiting + logging + monitoring |
| Routing information must be protected | Routing authentication + router hardening |

> Key points: IPv4 has no built-in confidentiality or strong source authentication; **ESP** is the choice when confidentiality is required (AH doesn't encrypt); **tunnel mode** protects the whole packet; **IKEv2** builds and manages SAs.
