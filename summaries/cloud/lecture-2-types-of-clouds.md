# أنواع السحاب في زمن الضباب
## Lecture 2 — Types of Clouds, Providers, and Data Centers

Q/ What are the two questions about any cloud ?
1. **Service model** — WHAT do you get? IaaS · PaaS · SaaS · DaaS (Lecture 1).
2. **Deployment model** — WHO owns the infrastructure and WHO shares it? Private · Public · Hybrid · Multi-cloud (Lecture 2).

> The two choices are **independent**. Example: Gmail is **SaaS** (service model) delivered from a **public** cloud (deployment model).

---

## Deployment models

**Private Cloud** : cloud infrastructure **dedicated to a single organization**, run in its own data center or in a provider's dedicated space.

Q/ What are the characteristics of a private cloud ?
1. One tenant: no sharing with other customers.
2. Full control of hardware, network and policy.
3. High upfront cost (**CapEx**) and in-house staff.
4. Elasticity limited by the hardware you own.

Q/ Name technologies used to build a private cloud.
- OpenStack · VMware vSphere · Proxmox · Kubernetes on your own servers.

> Security angle: you own the whole stack, so you own the **whole security burden** (physical access, patching, monitoring, incident response).

**Public Cloud** : infrastructure **owned and operated by a provider** and rented to many customers (tenants) over the internet.

Q/ What are the characteristics of a public cloud ?
1. **Multi-tenant**: resources shared and isolated logically.
2. **Pay-as-you-go** (OpEx), no upfront hardware.
3. Near-instant elasticity and global regions.
4. The provider secures the infrastructure layers.

Q/ Name the major public cloud providers.
- AWS · Microsoft Azure · Google Cloud (also Alibaba, Oracle, IBM, DigitalOcean).

> Security angle: **shared responsibility** — the provider secures the cloud, you secure what you put **in** it. **Misconfiguration** is a leading cause of public-cloud breaches.

| Aspect | Private cloud | Public cloud |
|---|---|---|
| Ownership | Single organization | Provider; shared by many tenants |
| Cost model | High upfront (CapEx) | Pay-as-you-go (OpEx) |
| Elasticity | Limited by owned hardware | Near-unlimited, on demand |
| Control | Full | Limited to what the provider exposes |
| Time to deploy | Weeks to months | Minutes |
| Security duty | Entirely the organization | Shared with the provider |
| Best for | Strict compliance, steady workloads | Variable demand, fast growth |

---

**Hybrid Cloud** : a **private** cloud (or on-premises) and a **public** cloud working together, connected by a VPN or dedicated link.

Q/ What are the uses of hybrid cloud ?
1. **Cloud bursting**: run normally in-house; rent public capacity only for peaks.
2. **Data residency**: keep regulated data local; use the public cloud for everything else.
3. **Gradual migration**: move workloads to the cloud step by step.

> Security angle: the **link between the two worlds** is a new attack surface; encrypt it and keep policies consistent on both sides.

**Multi-Cloud** : using **two or more public cloud providers**, for different workloads or for the same workload.

| Multi-cloud benefits | Multi-cloud challenges |
|---|---|
| Less lock-in | More skills needed |
| Resilience to one provider's outage | Different IAM and tools per provider |
| Best service for each task | Egress fees between clouds |

| Hybrid | Multi-cloud |
|---|---|
| Private + public, working together | Two or more **public** providers |

> A company can be **both** hybrid and multi-cloud at the same time.

---

## Providers

**Provider Lock-in** : switching providers becomes so costly or difficult that you stay even when you would rather leave.

Q/ What creates lock-in ?
1. Proprietary services and APIs (managed databases, serverless).
2. **Data gravity**: large datasets are slow and costly to move out.
3. **Egress** (data-out) fees.
4. Team skills and tooling tied to one platform.
5. Long-term contracts and commitments.

Q/ How to reduce lock-in ?
1. Containers and Kubernetes for portable workloads.
2. Infrastructure as Code (e.g. Terraform).
3. Open standards and portable data formats.
4. Regular exports and tested backups.
5. A written **exit plan** before you sign.

> Security angle: lock-in is also an **availability and resilience** risk (outage or changed terms, and no quick alternative).

**Hyperscale** : providers running data centers with very large server counts across a global footprint of **regions and availability zones**.

Q/ What makes a provider hyperscale ?
1. Data centers with very large server counts.
2. Global footprint of regions and zones.
3. Custom hardware, chips and networking.
4. Automation of almost everything.

**Region** : a geographic area containing several availability zones.
**Availability Zone** : a separate facility (one or more data centers) in a region, linked to the others by fast private networks, so **one failure doesn't take everything down**.

> Security angle: **concentration risk** — much of the internet depends on a few hyperscalers, so one failure can ripple widely.

---

## Inside the data center

**Rack** : a standard frame (about **42U**) holding servers and a **top-of-rack switch**.
**Aisle** : the space between rows, used to control cool and hot air flow (cold aisle in, hot aisle out).
**Pod** : a group of racks sharing power, cooling and network uplinks — the unit you add as you grow.

Q/ What is the power path in a data center ?
- Utility grid → **UPS** (batteries bridge the gap) / backup **generator** → **PDU** (distributes power to each rack) → rack.

Q/ How is a data center cooled ?
1. Hot/cold aisle containment keeps air streams apart.
2. Air-conditioning units (CRAC/CRAH) move the heat out.
3. Chilled water and liquid cooling for very dense racks.
4. Site and climate choices can cut cooling cost.

**PUE (Power Usage Effectiveness)** : total facility power ÷ power used by IT equipment. **1.0 is ideal**; lower = less energy wasted on cooling and power losses.

> Example: facility uses 1.5 MW and IT equipment 1.0 MW → PUE = 1.5.

| North-South traffic | East-West traffic |
|---|---|
| Between users outside and servers inside the data center | Between servers inside (replication, microservice calls, data processing) |
| Seen by the perimeter firewall | Usually the **larger** share; perimeter firewalls rarely see it |

> Security angle: attackers move **laterally** east-west; **micro-segmentation** and **zero trust** limit it.

**Leaf-Spine** : every leaf switch connects to every spine switch, so any two servers are the **same number of hops** apart.

Q/ Why use leaf-spine ?
1. Predictable latency (equal hops).
2. More servers → add leaves; more bandwidth → add spines.
3. Many equal-cost paths: one failed link barely matters.

**Fat-Tree** : the idea of many parallel equal paths with full bandwidth; leaf-spine is its common practical form.

**Unified data center network** : one Ethernet fabric carries user, storage and management traffic instead of a separate network for each (fewer devices and cables, simpler operations; needs priorities and isolation).

Q/ What are the data-center security takeaways ?
1. Control physical access to racks and cages.
2. Separate the **management network** from user and storage traffic.
3. Watch east-west traffic, not only the perimeter.
4. Treat power and cooling redundancy as **availability controls**.

---

## Security across deployment models

| Model | Who secures what | Key risk | Typical controls |
|---|---|---|---|
| Private | The organization, all layers | Under-resourced patching and monitoring | Hardening, SIEM, physical access control |
| Public | Shared with the provider | Misconfigured storage and IAM | Least privilege, MFA, encryption, posture checks |
| Hybrid | Both sides, plus the link | Weak link, inconsistent policies | Encrypted tunnels, unified identity, segmentation |
| Multi-cloud | Each provider separately | Bigger attack surface, tool sprawl | Central identity, policy-as-code, unified logging |

> Rule of thumb: the more places your data lives, the more consistent your **identity and logging** must be.

Q/ Mini case — a national bank must keep records in the country, has unpredictable salary-day peaks, and fears one vendor. Which model ?
1. Regulated data → private or **hybrid**.
2. Unpredictable demand → public elasticity.
3. Fear of one vendor → **multi-cloud**.
- Recommendation: **hybrid** (records stay in a private/in-country cloud, the app front-end bursts to public), ideally with **more than one public provider**.
