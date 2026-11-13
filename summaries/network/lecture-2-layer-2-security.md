# الطبقة الثانية والمصائب الآتية
## Lecture 2 — Layer 2 (Ethernet) Security and Protection

**Layer 2 (Data Link)** : provides **local** network communication using frames, MAC addresses, switches and VLANs.

**Ethernet** : the most common wired LAN technology; information is carried in **frames**.

Q/ What are the fields of an Ethernet frame ?
1. **Destination MAC**: the intended receiver.
2. **Source MAC**: the sending interface — switches use it for **learning**.
3. **Type/Length**: the carried protocol (IPv4, IPv6, ARP).
4. **Payload**: the actual information.
5. **FCS (Frame Check Sequence)**: detects transmission errors; damaged frames are discarded.

| MAC address | IP address |
|---|---|
| Layer 2 | Layer 3 |
| Local frame delivery | Communication between networks |
| Used by switches | Used by routers |
| e.g. 00:25:96:FF:12:34 | e.g. 192.168.10.5 |

> A MAC address is **not strong proof of identity**: software can change or imitate it.

---

## How a switch works

**MAC address table** : maps MAC addresses to switch ports.

> The switch **learns from the source MAC** but **forwards by the destination MAC**.

| Situation | Switch action |
|---|---|
| Known destination MAC | Forward only to the correct port |
| Unknown destination MAC | **Flood** to all other ports in the same VLAN (except the incoming one) |
| Broadcast FF:FF:FF:FF:FF:FF | Send to all ports in the broadcast domain (except the incoming one) |

Q/ Why does Layer 2 need security ?
- Its protocols were built for fast local communication and **trust** what devices send: the switch learns any source MAC, ARP accepts IP-to-MAC claims, DHCP clients accept configuration, STP exchanges BPDUs — all can be abused.

---

## Attacks and protections

**MAC flooding** : the attacker sends many frames with **fake source MACs** to fill/disturb the MAC table; unknown unicast is then flooded, exposing traffic and reducing performance.

**MAC spoofing** : the attacker uses **another device's MAC** to imitate it.

| | MAC flooding | MAC spoofing |
|---|---|---|
| Goal | Disturb the MAC table | Imitate another device |
| Protection | **Port Security** | **802.1X**, Port Security, stronger authentication |

Q/ What can Port Security do ?
1. **Limit the number** of MAC addresses allowed on a port.
2. Use **static**, **dynamically learned** or **sticky** secure MACs.
3. **Drop** unauthorized traffic or **disable** the port on a violation.

**ARP (Address Resolution Protocol)** : discovers the MAC address associated with an IPv4 address on the local network.

**ARP spoofing** : sending **false ARP replies** (e.g. "192.168.1.1 is at CC:CC:…:03", the attacker's MAC), because basic ARP doesn't strongly authenticate replies → traffic goes through the attacker (**Man-in-the-Middle**).

Q/ What are the possible results of ARP spoofing ?
1. Traffic interception. 2. Traffic modification. 3. Session hijacking. 4. Denial of service.

Q/ How to protect against ARP spoofing ?
1. **Dynamic ARP Inspection (DAI)**.
2. **DHCP Snooping**.
3. Network segmentation.
4. Encryption of application traffic.
5. Monitoring for unusual or duplicate ARP entries.

> **DAI** validates ARP using trusted IP-to-MAC bindings, commonly learned from the **DHCP Snooping database**.

---

**DHCP** : automatically gives clients an IP address, mask, default gateway, DNS server and lease time.

**DORA** : the normal DHCP process — **D**iscover → **O**ffer → **R**equest → **A**cknowledge.

| Attack | What happens | Effect / protection |
|---|---|---|
| **Rogue DHCP server** | An unauthorized server gives false settings (fake gateway, malicious DNS) | Traffic redirected → **DHCP Snooping** |
| **DHCP starvation** | Many fake DHCP requests consume the address pool | Users get no IP → DHCP Snooping + **rate limiting** |

Q/ What does DHCP Snooping do ?
1. Classifies switch ports as **trusted** or **untrusted**.
2. Blocks DHCP **server** messages from untrusted ports.
3. Builds a **binding database** (IP, MAC, VLAN, port, lease).
4. Supports **DAI** and **IP Source Guard**.

> Trusted ports lead toward the real DHCP server; user-facing ports are untrusted.

---

**VLAN** : logically separates a switched network into different **broadcast domains** (students, staff, servers…), reducing exposure and allowing different policies.

| VLAN hopping type | Idea | Basic protection |
|---|---|---|
| **Switch spoofing** | Attacker pretends to be a switch and negotiates a **trunk** | Configure user ports as **access** ports; disable automatic trunk negotiation |
| **Double tagging** | A frame with **two VLAN tags** crosses VLAN boundaries | Use a dedicated unused **native VLAN**; no user devices on it |

**STP (Spanning Tree Protocol)** : prevents switching loops and elects a **root bridge**.

**STP manipulation** : an unauthorized switch sends **superior BPDUs** to become root → change topology, redirect traffic, or cause instability.

| BPDU Guard | Root Guard |
|---|---|
| Used on **host-facing access ports** | Used where the root must not appear |
| Unexpected BPDU → port disabled | Prevents an unexpected switch from becoming root |
| Protects **edge ports** | Protects the **root-bridge position** |

**IEEE 802.1X** : authenticates users/devices **before** normal network access.

| 802.1X component | Role |
|---|---|
| **Supplicant** | The user device requesting access |
| **Authenticator** | The switch or access point controlling the port |
| **Authentication server** | Verifies credentials |

---

## Summary tables

| Control | Main purpose |
|---|---|
| Port Security | Limits which MACs can use a port |
| Disable unused ports | Reduces unauthorized physical access |
| VLAN segmentation | Separates users/services into zones |
| DHCP Snooping | Blocks rogue DHCP; builds trusted bindings |
| DAI | Validates ARP against trusted bindings |
| IP Source Guard | Filters source IP/MAC on untrusted interfaces |
| BPDU Guard | Stops STP on user-facing ports |
| Root Guard | Protects the intended root |
| IEEE 802.1X | Authenticates before access |

| Attack | Objective | Protection |
|---|---|---|
| MAC flooding | Fill/disturb the MAC table | Port Security |
| MAC spoofing | Imitate another device | 802.1X, Port Security |
| ARP spoofing | Redirect or intercept traffic | DAI, DHCP Snooping, encryption |
| Rogue DHCP | Give clients false configuration | DHCP Snooping |
| DHCP starvation | Exhaust IP addresses | DHCP Snooping, rate limiting |
| VLAN hopping | Reach another VLAN | Access mode, no negotiation, secure native VLAN |
| STP manipulation | Change switching topology | BPDU Guard, Root Guard |
| Unauthorized connection | Gain network access | Disable unused ports, 802.1X |

Q/ University case — fix each problem.
1. All users in one VLAN → separate VLANs (students, teachers, admin, servers, guests).
2. Unused ports active → shut them down and put them in an unused VLAN.
3. Unknown devices connect → 802.1X. Too many MACs on a port → Port Security.
4. Rogue DHCP possible → DHCP Snooping. ARP spoofing → DAI.
5. Students connect switches → BPDU Guard. Unexpected root → Root Guard.

> Don't trust a device just because it's connected; a MAC isn't identity; combine controls (**defense in depth**).
