# الغيوم في حوسبة القوم
## Lecture 1 — The Era of Cloud Computing

**Cloud Computing** : renting computing (servers, storage, networks, software) from a provider over the internet, on demand, instead of buying and running your own machines.

**Bare-metal era** : one organization buys, owns, cools, patches and physically secures its own servers in its own data room.

Q/ What were the problems of the bare-metal era ?
1. High **CAPEX**: hardware is bought up front, before demand is known.
2. **Fixed capacity**: you either over-provision (waste) or under-provision (outage).
3. Every patch, backup and physical control is the owner's job alone.
4. Scaling means buying, shipping and racking new machines: **weeks, not minutes**.

---

**The Power Wall** : around the mid-2000s chips could no longer get meaningfully faster, because higher clock speeds mean exponentially more **heat and power** draw.

Q/ What was the industry's answer to the Power Wall ?
- Stop chasing raw speed: add **more cores** and **more machines**.
- Spread the work across them: **parallel and distributed computing**.
- This is why cloud data centers are built from **thousands of ordinary machines**, not one extraordinary one.

Q/ What is "scaling out" (horizontal scaling) and what are its building blocks ?
1. **Server**: one physical machine (CPU, RAM, disk, NIC).
2. **Rack**: 10–40+ servers in one cabinet, sharing power and networking.
3. **Aisle / Pod**: rows of racks grouped for airflow, power and network design.
4. **Data center**: thousands of racks, the physical body of "the cloud".

---

**Elastic Computing** : the ability to automatically **acquire** more computing resources when demand rises and **release** them when demand falls, paying only for what is actually used.

> Example: an exam-result portal scales up for the result-day spike, then scales back down: no manual purchase and no idle hardware afterward.

**Multi-tenant cloud** : many independent customers (**tenants**) share the same physical hardware, while each tenant's data and workloads stay **logically isolated**.

Q/ Who enforces isolation in a multi-tenant cloud ?
- **Software**: the hypervisor or the container runtime. Its correctness is now a **core security control**.

Q/ What new attack surface does multi-tenancy create ?
1. **Hypervisor escape** (breaking out of a VM).
2. **Side-channel attacks** (e.g. cache timing between neighbours).
3. **Noisy-neighbour** resource abuse.

None of these exist in a single-tenant bare-metal setup.

---

## Service models

**IaaS (Infrastructure as a Service)** : the provider supplies raw virtualized compute, storage and networking; you install and manage everything above it.

**PaaS (Platform as a Service)** : the provider manages the OS, runtime and middleware; you deploy only your code and data.

**SaaS (Software as a Service)** : the provider runs the whole application; you just use it (usually in a browser) and manage your data and user access.

**DaaS (Desktop as a Service)** : a complete virtual desktop (OS, apps, user profile) streamed from the cloud to any device. It is really **SaaS applied to the desktop**.

| | IaaS | PaaS | SaaS | DaaS |
|---|---|---|---|---|
| You manage | OS, runtime, apps, data | Apps & data only | Your data & access | Your files & profile |
| Provider manages | Virtualization, servers, storage, network | + OS, runtime, middleware | The entire stack | Full OS + app stack |
| Examples | Amazon EC2, Azure VMs, Google Compute Engine | Azure App Service, Google App Engine, Heroku | Google Workspace, Microsoft 365, Salesforce, Zoom | Amazon WorkSpaces, Windows 365, Citrix DaaS |
| Typical users | Sysadmins, DevOps, infrastructure engineers | Application developers, small teams | Everyone | Remote workforces, call centers, students |
| Control | Maximum | Medium | Minimum | Minimum |

> Rule: moving **left → right**, the provider takes more of the **management burden** and more of the **security responsibility**.

Q/ In SaaS, what does the customer still own ?
1. Identity and access management (account security).
2. Data classification and the data you upload.
3. End-user device security.

Q/ Why do organizations use DaaS ?
- Consistent, centrally-managed desktops for remote or contract staff.
- Sensitive data **never leaves the data center**: the endpoint only displays pixels, so a lost laptop does not mean lost data.

---

## Why it matters for a security engineer

**Shared Responsibility** : every cloud service has a line between what the **provider** secures and what **you** secure. The line **moves with the service model**.

Q/ What are the three security takeaways of Lecture 1 ?
1. **Shared responsibility**: know exactly where the line sits before designing a control.
2. **New attack surface**: multi-tenancy, hypervisors and APIs did not exist in the bare-metal era.
3. **Elasticity cuts both ways**: auto-scaling defends against load spikes, but a misconfigured resource can also scale an attacker's **cost abuse or cryptomining**.

Q/ Bare metal vs cloud — compare.

| Point | Bare metal | Cloud |
|---|---|---|
| Cost | CAPEX, paid up front | Pay for what you use |
| Capacity | Fixed at purchase | Elastic, on demand |
| Time to scale | Weeks | Minutes |
| Hardware | Owned by one organization | Shared by many tenants |
| Security duty | All on the owner | Shared with the provider |

> One-sentence summary: the Power Wall forced computing to scale horizontally, giving rise to elastic, multi-tenant clouds offered at four levels — IaaS, PaaS, SaaS, DaaS — each shifting the security boundary.

Q/ (Discussion) A bank moves its core app from bare metal to SaaS. What controls does it lose direct control over ?
- OS and patching, the runtime, the application code, physical security and network controls: all move to the provider. The bank keeps identity/access, its data, and its users' devices.
