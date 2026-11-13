# الشبكات الوهمية والخزانات الخفية
## Lecture 4 — Virtual Networks and Virtual Storage

Q/ Why must the network be built in software in the cloud ?
1. **Isolation per tenant**: each customer needs a private network others can't see, even on the same physical switches.
2. **Agility**: a network, subnet or firewall rule is created in seconds by an **API call**, not by a technician with a cable.
3. **Mobility**: when a VM live-migrates it keeps its IP and network policy — the network must **follow the VM**.

---

## Virtual NICs and switches

**Virtual NIC (vNIC)** : a software network card given to a VM, with its own MAC address.

**Virtual switch (vSwitch)** : forwards frames between VMs on the same host **in software**; frames for other hosts leave through the physical uplink.

> Examples: VMware vSwitch, Hyper-V vSwitch, Linux bridge, **Open vSwitch (OVS)**, Docker bridge.
> Security: traffic between two VMs on one vSwitch **never meets the physical firewall** — use port security and limit promiscuous mode.

Q/ Compare the VM network modes.

| Mode | How the VM connects | Reaches the internet | Reachable from the LAN | Typical use |
|---|---|---|---|---|
| **Bridged** | A separate device on your real network with its own LAN address | Yes | Yes | Servers other machines must reach |
| **NAT** (Lab 3) | Shares the host's address; VMware translates | Yes | No (unless port forwarding) | Labs, safe default |
| **Host-only** | Private network between VM and host only | No | No | Isolated testing, malware analysis |

> Rule: choose the **least exposed** mode that works. Bridged puts the VM directly on your LAN.

---

## VLAN

**VLAN (Virtual LAN)** : splits one physical switch into several separate **broadcast domains**.

Q/ How does a VLAN work ?
1. **Access ports** belong to one VLAN.
2. **Trunk ports** carry several VLANs; each frame is tagged with **802.1Q (4 bytes)**.
3. The VLAN ID is **12 bits → 1 to 4094 usable**.
4. Different VLANs talk only through a **router or Layer 3 switch**.

Q/ Why are VLANs not enough for the cloud ?
1. Only **4094** IDs — a cloud has thousands of tenants.
2. Each VLAN is a flat **Layer 2** domain tied to one switched network.

---

## Underlay and overlay

**Underlay** : the real, physical routed IP network (e.g. leaf-spine).
**Overlay** : the virtual network the tenant sees, built **on top of** the underlay with tunnels.

> Like a letter in an envelope: the postal network reads only the **outer** address. Two tenants can even reuse the same 10.0.0.0/24 without conflict.

Q/ What are the four steps of an overlay (VXLAN) ?
1. **Send**: VM A sends a normal frame to VM B (it doesn't know a tunnel exists).
2. **Wrap**: the VTEP on Host 1 looks up (VNI, MAC B), finds Host 2, and adds outer Ethernet + IP + **UDP 4789** + VXLAN headers (~50 bytes).
3. **Route**: the underlay routes by the **outer IP only**; tenant addresses stay hidden.
4. **Unwrap**: the VTEP on Host 2 reads the VNI, removes the outer headers, and delivers the original frame to VM B.

**VXLAN** : wraps the tenant's whole Ethernet frame inside a **UDP** packet — "Layer 2 over Layer 3".

**VNI (VXLAN Network Identifier)** : 24 bits → about **16 million** virtual networks (2²⁴).

**VTEP (VXLAN Tunnel Endpoint)** : sits in the host's vSwitch or a leaf switch, and wraps/unwraps frames.

Q/ What is the VXLAN header layout ?
- Outer Ethernet **14 B** · Outer IP **20 B** · UDP **8 B (port 4789)** · VXLAN header **8 B (carries the VNI)** · inner Ethernet frame → ≈ **50 B overhead**.

**MTU pitfall** : the 50 extra bytes can push packets over 1500 → raise the underlay MTU (e.g. **9000**) or lower the VM MTU to about **1450**.

> Security: **VXLAN does not encrypt or authenticate**. The VNI separates tenants only logically — protect the underlay and use IPsec or WireGuard for sensitive traffic.

| Aspect | VLAN | VXLAN |
|---|---|---|
| Segment ID | 12 bits: 4094 usable | 24-bit VNI: ~16 million |
| How it isolates | A tag on the Ethernet frame (802.1Q) | The frame is wrapped in UDP/IP (tunnel) |
| Reach | Within one switched Layer 2 network | Across a routed IP network, even between sites |
| Overhead | 4 bytes | ~50 bytes |
| Configuration | Switch ports and trunks, often manual | Tunnel endpoints + control plane (e.g. BGP EVPN), automated |
| Best for | Campus, small or fixed data centers | Multi-tenant clouds, large data centers |

> In practice: VLANs inside a rack/campus, VXLAN across the data-center fabric.

Q/ Map the public-cloud network building blocks.

| Building block | Does | AWS | Azure |
|---|---|---|---|
| Virtual network | Your private address space | VPC | VNet |
| Subnet | A slice, public or private | Subnet | Subnet |
| Route table | Where traffic goes next | Route table | Route table (UDR) |
| Internet access | In/outbound paths | Internet gateway, NAT gateway | Public IP, NAT Gateway |
| Firewall rules | Allow/deny by port, protocol, source | Security group (**stateful**), NACL (**stateless**) | NSG |

> Default deny. **Never** allow SSH (22) or RDP (3389) from **0.0.0.0/0**. Keep databases in **private** subnets.

---

## SDN

**SDN (Software-Defined Networking)** : separates the **control plane** (decides the rules, centralized in a controller) from the **data plane** (switches that only forward packets by the rules).

| Traditional network | SDN |
|---|---|
| Every switch runs its own control logic, configured one by one | Logic centralized in software (the controller) |
| Hard to change and automate | One policy change reaches every switch in seconds, via API |

Q/ What are the SDN layers and APIs ?
1. **Applications** (routing, firewall, load balancing, monitoring) — talk to the controller through the **Northbound API (REST)**.
2. **SDN controller** = control plane, global view.
3. **Switches** = data plane — controlled through the **Southbound API (OpenFlow)**.

**OpenFlow** : a southbound protocol; the switch keeps **flow tables** — if a packet **matches** these fields, perform this **action**.

| Priority | Match | Action |
|---|---|---|
| 300 | src 10.0.1.5, TCP 22 | Drop |
| 200 | dst 10.0.2.0/24 | Forward to port 3 |
| 100 | VLAN 20 | Forward to port 5 |
| 0 | anything else (**table-miss**) | Send to controller |

Q/ What happens when no flow entry matches ?
1. The switch sends a **packet-in** message to the controller.
2. The controller decides and replies with a **flow-mod**.
3. Later packets of that flow match the new entry and are forwarded at full speed.

> OVS is the most common OpenFlow software switch; **P4** goes further and programs how the switch parses packets.
> Security: the controller is a **high-value target** — whoever controls it controls the network. Isolate it, authenticate switches, use TLS, restrict API access.

---

## Storage

| | Block | File | Object |
|---|---|---|---|
| Data unit | Fixed-size blocks | Files in folders | Object + metadata + ID |
| Access | Raw disk: iSCSI, Fibre Channel | NFS, SMB over the network | HTTP **REST API** |
| Examples | AWS EBS, Azure Disk, SAN | AWS EFS, Azure Files, NAS | AWS **S3**, Azure Blob, MinIO |
| Strength | Low latency, high speed | Familiar, shared by many users | Huge scale, cheap, durable |
| Limit | One VM at a time, no sharing | Scaling and locking get harder | Not for databases or editing in place |
| Best for | VM disks, databases | Shared folders, home directories | Backups, media, logs, big data |

| Traditional storage | Software-defined storage |
|---|---|
| **DAS** (disks in one server), **NAS** (file server), **SAN** (dedicated block network) | Software on commodity servers |
| **Scale-up**: buy a bigger, costlier array | **Scale-out**: add nodes, capacity and speed grow |
| Vendor hardware and tools | Pools many disks into one logical store; policies by API |
| | Examples: **Ceph, HDFS, VMware vSAN, MinIO** |

**Replication** : 3 full copies on different nodes — simple and fast, but **3× the space**.
**Erasure coding** : data split into 4 pieces + 2 parity — survives **2 failures at 1.5× space**.

> Replication protects against **failure**, not against **deletion or ransomware**: keep separate backups.

---

## Security lens

| Area | Typical risk | Good practice |
|---|---|---|
| VLAN & vSwitch | VLAN hopping via trunk misconfiguration; unseen east-west traffic | Disable unused ports, fix native VLAN, micro-segmentation |
| Overlay (VXLAN) | Unencrypted tunnels; attacker on the underlay reads/injects | Secure the underlay; IPsec or WireGuard |
| Cloud network rules | Security groups open to 0.0.0.0/0; exposed databases | Least privilege, private subnets, rule audits |
| SDN controller | Single point of control and failure; rogue switches | Isolate, TLS, authenticate, redundant controllers |
| Storage | Public buckets, unencrypted data, leaked snapshots/backups | Block public access, encrypt at rest & in transit, manage keys, versioning |

Q/ Mini case — university private cloud (Teaching, Research, Administration): which storage for each need ?
1. Exam PDFs for 2,000 students → **object** (scale, cheap, read-mostly).
2. Lab VM disks → **block** (low latency, one VM per disk).
3. Shared Linux home folder → **file** (NFS/SMB, shared).
- Keep student VMs away from admin: separate segments (VLAN/VXLAN per tenant) + default-deny firewall rules. VLANs may be enough for 3 tenants; move to **VXLAN** when tenants/segments grow or span sites.
