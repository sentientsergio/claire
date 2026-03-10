# Axioms, Pragmas, and Undefined Behavior: A Systems Theory of Governance

*Sergio DuBois*

---

## The Pattern

"All men are created equal."

This is not an argument. It is not a conclusion derived from evidence. It is an assertion — accepted without proof, treated as foundational — upon which an entire system of governance is constructed. You don't argue whether equality is *correct* within the constitutional system. You argue *from* it. Everything downstream — legislation, case law, policy, institutional design — derives its legitimacy by reference to this foundational commitment.

That is what an axiom does.

"The enumeration in the Constitution of certain rights shall not be construed to deny or disparage others retained by the people."

That is the Ninth Amendment, and it is a different kind of statement entirely. It doesn't assert a right. It advises the interpreter on how to read the rest of the document. It says: this list is not exhaustive. Do not optimize away rights simply because they are not enumerated. The absence of specification is not evidence of absence.

That is what a pragma does.

These two structural elements — the foundational commitment and the interpretive advisory — appear together in every governed system I have examined. They appear in constitutions. They appear in corporate charters. They appear in the design of distributed computing systems. They appear at different scales within the same system. And the way a system handles the relationship between them — and the inevitable cases where neither applies — predicts whether that system will prove resilient or fragile when it encounters the unknown.

This essay proposes a minimal vocabulary for analyzing governed systems across domains: **axiom**, **pragma**, **interpreter**, **amendment process**, and **undefined behavior**. The claim is not metaphorical. It is structural. These elements are present in any system that must maintain coherence over time while being interpreted by multiple agents. Understanding them — and especially understanding what happens when they fail — gives us a diagnostic framework for predicting where systems will break.

---

## The Vocabulary

**Axiom.** A foundational commitment that constrains all downstream behavior within the system. Axioms are the things you reason *from*, not *toward*. They are accepted without proof within the system's frame, and violating them means leaving the system entirely. A system's axioms define what it *is*. A constitutional democracy that abandons equal protection under law hasn't reformed itself — it has become a different system.

**Pragma.** An advisory directive that shapes how interpreters should handle the axioms in context. Pragmas are not foundational — they can be modified, overruled, or ignored without destroying the system's identity. But they are not trivial. They encode the accumulated wisdom of how the system's axioms should be applied in practice. Pragmas depend on the judgment of the interpreter, and their application may vary across environments while still referencing the same foundational axioms.

**Interpreter.** The agent or institution that applies axioms and pragmas to specific cases. Interpreters are not passive. They make decisions that shape the system's behavior in ways the founders may not have anticipated. The quality of a governed system depends heavily on the quality of its interpreters and the constraints placed upon their discretion.

**Amendment Process.** The mechanism by which a system modifies its own axioms. This is the most remarkable feature of a governed system — the capacity for self-revision. Most formal axiomatic systems cannot modify their own foundations from within. Governed systems solve this by making the amendment process extraordinarily expensive: supermajorities, ratification requirements, multi-stakeholder approval. The cost is itself a feature. It ensures that axioms are only modified under conditions of extraordinary consensus, preserving stability while permitting evolution.

**Undefined Behavior (UB).** The condition that arises when a system encounters a case its axioms do not address and its pragmas do not advise upon. The system has no defined response. Crucially, this is not a bug. It is an inherent property of any finite set of axioms attempting to govern an unbounded reality. The system's behavior in these cases carries no guarantees — what happens depends entirely on the runtime environment: the interpreters, the institutions, the norms, the trust relationships that exist outside the formal system.

---

## Constitutional Law

The United States Constitution is the clearest illustration because its structure is the most explicitly layered.

**The axioms** are the rights and structural commitments. "Congress shall make no law respecting an establishment of religion, or prohibiting the free exercise thereof." "No person shall be deprived of life, liberty, or property without due process of law." These are non-negotiable within the system. You cannot argue against due process from within constitutional law — you can only argue about what due process *requires*. The axiom is the floor beneath every argument.

**The pragmas** are the interpretive frameworks that have accumulated around the axioms. Strict scrutiny. Compelling state interest. The Lemon test. Time, place, and manner restrictions. None of these appear in the Constitution. They are advisory frameworks developed by the interpreters — the courts — to handle the application of axioms to cases the founders could not have anticipated. "Congress shall make no law abridging the freedom of speech" is an axiom. "You cannot falsely shout fire in a crowded theater" is a pragma — an interpretive advisory that weighs the axiom against competing concerns in a specific context.

**The interpreters** are the courts, and above all the Supreme Court. Their role is not merely to apply the axioms mechanically but to exercise judgment about how axioms interact, how pragmas should evolve, and where the boundaries of defined behavior lie. The history of constitutional law is substantially the history of interpretive disagreement — not about whether the axioms apply, but about what they mean in practice.

**The amendment process** is Article V. It requires two-thirds of both houses of Congress and ratification by three-fourths of state legislatures. This is deliberately, almost prohibitively expensive. It has succeeded only twenty-seven times in nearly two and a half centuries. The expense is the point: axioms should not be easy to change. The amendment process is the system's mechanism for self-revision without self-destruction.

**Undefined behavior** is what happens when the constitutional system encounters a case its axioms and pragmas cannot resolve. The question of secession was UB. The Constitution said nothing coherent about whether states could leave the union. Decades of pragmatic interpretation — legislative compromises, court rulings, political agreements — papered over the gap. When the UB finally triggered in 1860, the system did not degrade gracefully. It crashed catastrophically. The resolution required four years of war and the rewriting of foundational axioms through the Thirteenth, Fourteenth, and Fifteenth Amendments.

This is the critical lesson: UB does not announce itself. It accumulates silently in the spaces where the axioms are silent, and it triggers when external pressure makes the silence untenable.

---

## Organizational Governance

A corporation or institution exhibits the same architecture, typically at a faster clock speed and with less formal structure.

**The axioms** are the charter, the articles of incorporation, and the core commitments that define what the organization *is*. A nonprofit's mission statement is axiomatic — everything the organization does must be justifiable by reference to it. A corporation's fiduciary duty to shareholders is axiomatic. These commitments are the floor beneath every organizational decision. Violating them doesn't reform the organization; it breaks its legal and conceptual identity.

**The pragmas** are board resolutions, corporate policies, employee handbooks, cultural norms, and the accumulated body of "how we do things here." They advise. They shape behavior. They can be modified without existential crisis. A company can change its remote work policy without rewriting its charter. But pragmas are not trivial — they encode the organization's interpretive wisdom about how its axioms apply in practice, and poorly designed pragmas can undermine axiomatic commitments over time.

**The interpreters** are managers, executives, the board, and — in a distributed way — every employee who makes decisions about how to apply organizational policy to specific situations. In healthy organizations, interpretive authority is clearly delegated and subject to review. In unhealthy ones, interpretive authority is either concentrated to the point of autocracy or dispersed to the point of incoherence.

**The amendment process** varies enormously. A startup with two founders can amend its axioms over lunch. A publicly traded corporation requires shareholder votes, regulatory filings, and board approval. A government agency may require legislative action. The cost of the amendment process scales with the number of stakeholders and the severity of the consequences — as it should. An amendment process that is too cheap leads to axiom instability. One that is too expensive leads to ossification.

**Undefined behavior** is the crisis that the charter and policies do not cover. A co-founder dispute that the operating agreement never anticipated. A reputational crisis that falls outside any existing policy. A market shift that invalidates the organization's foundational assumptions. In these moments, the organization's behavior carries no guarantees from its formal governance structure. What happens depends on the runtime environment: the relationships, the trust, the institutional culture, the quality of the interpreters. Organizations with strong informal norms can navigate UB gracefully. Organizations that depend entirely on formal structure for coherence cannot.

The speed at which organizations encounter UB is accelerating. This is not because organizations are worse governed than they were. It is because the environment in which they operate is changing faster than any finite set of axioms and pragmas can anticipate.

---

## Distributed Systems

The axiom/pragma architecture appears with particular clarity in distributed computing because the constraints are mathematical rather than political, and the interpreters are machines rather than people. This domain strips the framework to its formal minimum and reveals the structure without the noise of human ambiguity.

**The axioms** are the impossibility theorems and formal constraints that define what any distributed system can and cannot do. The CAP theorem — that a distributed system cannot simultaneously guarantee Consistency, Availability, and Partition tolerance — is axiomatic. It is not a design choice. It is a proven mathematical constraint. Every distributed system must operate within the boundaries it defines, just as every constitutional system must operate within its foundational rights. You don't argue against CAP. You argue *from* it: given that we cannot have all three, which two do we prioritize?

**The pragmas** are the consistency models and design patterns that engineers choose in response to the axiomatic constraints. Eventual consistency. Strong consistency. Read-your-writes. Quorum-based replication. These are advisory frameworks — ways of handling the tradeoffs the axioms impose. They can be changed without violating the axioms. A system can move from eventual consistency to strong consistency; it's still operating within CAP. The pragma advises the interpreter (the system designer, the runtime) on how to apply the axioms in a particular operational context.

**The interpreters** are both the engineers who design the system and the runtime processes that execute it. The consensus algorithms — Paxos, Raft, PBFT — are formalized interpretive procedures. They define exactly how the system should adjudicate conflicting information under the constraints the axioms impose. Unlike human interpreters, they are deterministic. But like human interpreters, they can produce different outcomes depending on the pragmatic choices made at design time.

**The amendment process** is the protocol upgrade. Changing the fundamental consensus mechanism of a live distributed system is one of the hardest problems in the field — precisely because it requires modifying the system's foundational behavior while the system continues to operate. This is analogous to amending a constitution while the government continues to govern. The difficulty is not incidental. It is structural. The amendment process must be expensive enough to prevent casual modification of axioms while remaining possible enough to permit evolution.

**Undefined behavior** is the Byzantine case — the scenario where nodes behave in ways the system's axioms and pragmas did not anticipate. A node that doesn't just fail but actively sends contradictory information. A network partition that persists longer than any timeout was designed to handle. A coordination failure that cascades beyond the boundaries of any single fault-tolerance mechanism. In these cases, the system's behavior carries no guarantees. The output is undefined. What happens depends on the runtime environment — the monitoring, the human operators, the fallback procedures that exist outside the formal protocol.

The distributed systems community has been more disciplined than most governance domains about acknowledging and cataloging UB. Formal verification, chaos engineering, and game-theoretic analysis of failure modes are all methods for mapping the boundaries of defined behavior and stress-testing the system's response to undefined cases. Werner Vogels, Amazon's CTO, reduced the entire philosophy to five words: "Everything fails, all the time." The discipline is not in preventing failure. It is in building systems that assume it. Other governance domains have been slower to internalize this lesson.

---

## The Failure Mode Taxonomy

The axiom/pragma framework reveals four characteristic failure modes that appear across all governed systems.

**Brittleness: treating pragmas as axioms.** When an interpretive advisory hardens into a foundational commitment, the system loses its capacity to adapt. Fundamentalism — in any domain — is the treatment of pragmas as axioms. Constitutional originalism taken to its extreme. Corporate policies that become sacrosanct. Distributed systems designed around a specific consistency model with no mechanism for revision. The system becomes rigid precisely where it needs to be flexible. Pragmas exist to be revised; when they cannot be, the system accumulates stress at every point where reality has drifted from the original interpretive context.

**Incoherence: treating axioms as pragmas.** When foundational commitments become negotiable, the system loses its identity. An organization that routinely overrides its mission for short-term gain. A constitutional system that allows fundamental rights to be suspended by executive discretion. A distributed system that sacrifices its consistency guarantees for performance. The system hasn't adapted — it has dissolved. Its axioms no longer constrain downstream behavior, and the result is a governed system that is governed by nothing.

**Catastrophic UB: encountering undefined behavior with no graceful resolution mechanism.** This is the Civil War. The co-founder blowup that destroys the company. The Byzantine failure that cascades into total system collapse. The system encounters a case its axioms don't cover, its pragmas don't advise on, and its interpreters have no precedent for. In the absence of any defined response, the system's behavior is determined entirely by the runtime environment. If that environment is robust — strong norms, high trust, experienced interpreters — the system may survive. If it is not, the system collapses.

**Graceful UB handling: encountering undefined behavior and evolving.** This is the amendment process working as designed. The constitutional system encounters a case its axioms don't cover, and responds by amending its axioms to cover it. The organization encounters a crisis its policies don't address, and responds by developing new governance structures. The distributed system encounters a failure mode its protocol didn't anticipate, and responds by upgrading its consensus mechanism. The system doesn't just survive the UB — it expands the boundaries of its defined behavior. Graceful UB handling is how governed systems grow.

The diagnostic question for any governed system is: **which of these failure modes is it most susceptible to, and does it have the institutional capacity to recognize the condition before it becomes catastrophic?**

---

## The Gödel Connection

There is a deeper reason why undefined behavior is not a design flaw but a structural inevitability.

Gödel's incompleteness theorems demonstrate that any sufficiently complex formal system contains statements that are true but unprovable within the system. The system cannot, from within its own axioms, resolve every case it will encounter. This is not a limitation of particular systems. It is a property of formal systems as such.

The analogy to governed systems is direct. Any finite set of axioms attempting to govern an unbounded reality will encounter cases it cannot resolve. The constitutional framers could not anticipate every question the republic would face. The corporate charter cannot cover every contingency. The distributed system's protocol cannot account for every failure mode. UB is not the result of insufficient foresight. It is the inevitable consequence of finite foundations meeting infinite possibility.

This has a practical implication: **the quality of a governed system is not measured by whether it eliminates undefined behavior — which is impossible — but by how it handles undefined behavior when it inevitably arises.**

A system that pretends it has no UB is fragile. A system that acknowledges its UB and invests in graceful handling mechanisms — amendment processes, strong interpretive institutions, cultural norms that function outside formal governance — is resilient. The difference between a system that survives its crises and one that does not is rarely the quality of its axioms. It is the quality of its response to the cases its axioms cannot reach.

---

## Toward Prescription: The Founder's Problem

The framework above is diagnostic. It tells us how to see a governed system's structure and where to look for fragility. But it implies a harder question: if you are building a governed system — drafting a charter, designing a protocol, founding an institution — what does this framework tell you to do?

The answer begins with axiom selection, and axiom selection is the founder's burden. Every governed system inherits the quality of its founding commitments. The choices made at the constitutional convention — whether that convention produces a nation, a corporation, or a consensus protocol — constrain every future interpreter, every future crisis, every future amendment. Get the axioms wrong and the system carries that error in its foundations, accumulating stress until the UB triggers.

What makes a good axiom? It must be abstract enough to govern cases the founders cannot anticipate, yet specific enough to actually constrain behavior. "All men are created equal" has governed for nearly two and a half centuries because it operates at the right level of abstraction. A provision specifying a particular tax rate would not survive a generation — it is a pragma dressed as an axiom, and the system will eventually pay the cost of that miscategorization.

The founders should also choose fewer axioms than they think they need. Every axiom is a permanent constraint. Every pragma is a revisable one. The temptation at founding is to encode too much — to lock in not just the foundational commitments but the interpretive preferences of the founding generation. Systems that resist this temptation leave room for their interpreters. Systems that succumb to it become brittle before they encounter their first real test.

But axiom selection is only half the founder's problem. The other half is the interpreter lineage — the first generation of agents who translate axioms into practice. John Marshall shaped American constitutional meaning as profoundly as James Madison shaped constitutional text. The first engineering team operating a distributed system establishes pragmatic norms that calcify into quasi-axiomatic precedent. The founder chooses the axioms; the first interpreters choose what the axioms *mean*. A wise founder invests as heavily in interpreter quality and interpretive culture as in the axioms themselves.

Finally, the framework suggests that the most undervalued component of any governed system is the amendment process. Founders naturally focus on getting the axioms right. But the Gödel insight tells us that no finite set of axioms will be sufficient. The system *will* encounter undefined behavior. The question is whether it can evolve in response. An amendment process that is too expensive produces ossification — the system cannot adapt even when its axioms are demonstrably inadequate. An amendment process that is too cheap produces instability — the axioms shift with every political wind and cease to function as foundations. Calibrating this cost may be the single most consequential design decision a founder makes.

The full prescriptive treatment is beyond the scope of this essay. But the implication is clear: founding a governed system is not primarily an act of rule-making. It is an act of architectural design — choosing the right axioms, at the right level of abstraction, with the right amendment process, and investing in the interpretive culture that will carry the system beyond anything the founders themselves could foresee.

---

## What This Gives Us

The framework proposed here is diagnostic, not prescriptive. It does not tell us what a system's axioms should be. It tells us how to look at any governed system — political, organizational, technical — and ask precise questions about its structure and its vulnerabilities.

Where are the axioms, and are they clearly distinguished from the pragmas? Are pragmas hardening into axioms, creating brittleness? Are axioms softening into pragmas, creating incoherence? Where are the zones of undefined behavior, and is the system aware of them? Does the amendment process exist, and is its cost appropriately calibrated — expensive enough to protect axiom stability, cheap enough to permit evolution? Who are the interpreters, and are they adequate to the demands the system places on their judgment?

Every governed system answers these questions, whether it knows it or not. The framework simply makes the answers visible.

Systems do not fail because their axioms were wrong. They fail because the relationship between axioms, pragmas, and interpreters degraded until the system could no longer handle what it had not defined. They fail, in the end, at the boundaries — in the spaces where the system makes no promises and the only thing left is the quality of what was built around it.

---

*Draft v0.1 — February 2026*

---

> *This essay emerged from a conversation between the author and Claude (Anthropic). The framework, arguments, and editorial decisions are the author's. The drafting was collaborative.*