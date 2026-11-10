# SOC Analyst (entry-level) knowledge base, v0.6

Status: DRAFT. Not yet reviewed by SOC practitioners.
Source: 28 entry-level security operations job postings, recounted from the postings themselves. Postings are mostly from India. Batch 1 (11): an Exaforce partner, Marmon Technologies, NTT DATA, Brennan, Canbase, SISA, Fortuna Cysec, ReliaQuest, Banyan Cloud, Fresenius Medical Care, Bahwan CyberTek. Batch 2 (17): Quality Air, Medpace, Linearstack, PS Collaborations, an unnamed Security Analyst posting, Arrise Solutions, Reward360, ITOrizon, Whay Lab Solutions, Innovana Techlabs, Informica, BDreamz Global Solutions, Prudent Globaltech, Metmox, Paramarsh Informatics, ORYON, Inspired Infotech. More postings (banks, hospitals, other sectors) will be added and every count below recalculated.

## How items are tiered
Counts show how many of the 28 postings list the item as a requirement, a core duty or a listed skill. A "preferred" or "advantage" mention is counted only where the line says so. Duties listed as extra or senior responsibilities are not counted.
- MUST-HAVE [MH]: mentioned in 17 or more of 28 postings, and required or a core duty in at least 14.
- STRONGLY PREFERRED [SP]: mentioned in 13 or more of 28 postings but not meeting the must-have rule.
- NICE-TO-HAVE [NH]: 1 to 12 of 28 postings.
- PRACTITIONER-ADDED [PA]: NOT from the postings. Added from general SOC practice and pending review by SOC practitioners. Never describe these as "seen in postings".

## MUST-HAVE
- [MH1] SIEM familiarity and alert monitoring (seen in 28 of 28 postings)
- [MH2] Alert triage and incident response basics: classify an alert, follow a runbook or playbook, escalate with context (seen in 27 of 28 postings)
- [MH3] Core security concepts: common attack types, malware categories, authentication basics (seen in 19 of 28 postings)
- [MH4] Documenting investigations: tickets, incident notes, reports, shift handovers (seen in 23 of 28 postings)
- [MH5] Log analysis and log sources (seen in 21 of 28 postings)
- [MH6] Networking fundamentals: TCP/IP, DNS, HTTP and HTTPS (seen in 19 of 28 postings)
- [MH7] Clear written and verbal communication (seen in 21 of 28 postings)
- [MH8] Familiarity with security tools: EDR/XDR, firewalls, IDS/IPS, email security (required in 16 of 28 postings, an advantage in 4 more)
- [MH9] Operating system basics, Linux and Windows (seen in 17 of 28 postings)
  Note for reviewers on MH8 and MH9: these were strongly preferred in v0.3 and moved up because they meet the new must-have rule. Pending reviewer opinion.
  Note on MH4: ticketing tools named in postings are ServiceNow, Jira, BMC Remedy and Linear. A specific product is never required.

## STRONGLY PREFERRED
- [SP1] Basic scripting in Python, Bash or PowerShell (required or a core duty in 5 of 28 postings, preferred in 9 more)
- [SP2] A foundational security certification, or one in progress (mentioned in 18 of 28 postings and required in only 5: Security+ in 15, CEH in 11, CySA+ in 6)
- [SP3] Supporting vulnerability management: scanning and tracking fixes (seen in 16 of 28 postings)

## NICE-TO-HAVE
- [NH1] MITRE ATT&CK familiarity (seen in 7 of 28 postings)
- [NH2] Detection rule writing or SIEM tuning (seen in 7 of 28 postings)
- [NH3] Hands-on practice: TryHackMe, Hack The Box, CTFs, a home lab (seen in 8 of 28 postings, required in 1, and TryHackMe or Hack The Box is named in 3)
- [NH4] Cloud fundamentals: AWS, Azure or GCP (seen in 8 of 28 postings)
- [NH5] SOAR and automation platforms (seen in 2 of 28 postings)
- [NH6] Threat intelligence, indicator lookups and basic threat hunting (seen in 7 of 28 postings)
- [NH7] Identity and access basics: MFA, Entra ID, conditional access, least privilege (listed in 2 of 28 postings, and as a training topic in 1 more)
- [NH8] Phishing and email security (seen in 5 of 28 postings, 1 of them only as a key-skills tag)
- [NH9] Supporting compliance and audits: ISO 27001, NIST, SOC 2, log retention (seen in 9 of 28 postings)
- [NH10] Evidence collection and basic forensics (seen in 7 of 28 postings)
- [NH11] Basic SIEM search queries: Splunk SPL, Microsoft Sentinel KQL (seen in 2 of 28 postings)
- [NH12] Windows event log basics and Sysmon: logon events 4624 and 4625, process creation 4688 (seen in 1 of 28 postings)
- [NH13] Incident response lifecycle, NIST phases: preparation, detection and analysis, containment eradication and recovery, post-incident activity (seen in 3 of 28 postings)
  Note for reviewers on NH3: postings rarely ask for hands-on practice, but practitioners often say it is how a fresher without experience proves skills. Pending reviewer opinion.
  Note for reviewers on NH11, NH12: the detail on event IDs, Sysmon and query languages comes mainly from one posting (Paramarsh Informatics). Pending reviewer opinion on whether these belong higher.

## EXPECTATIONS (not skill gaps, never score these)
- A degree or diploma in CS, IT or a related field, or any degree (20 of 28 postings; preferred in 1 more).
- Rotational 24x7 shifts including nights and weekends (stated in 13 of 28 postings, some as "if required").
- One posting (Metmox) lists US citizenship as required for a remote role. It is counted, and may be a mistake in the posting.

## EVIDENCE TERMS (used by code to check resume bullets, not skill items)
A resume bullet can only count as this role's day-to-day work if it names the subject of the role. Words are matched from the start of a word, so "alert" also matches "alerts" and "detect" matches "detection". Practitioner-added, pending review.
Subject words: alert, incident, threat, attack, intrusion, malware, phishing, ransomware, detect, siem, edr, xdr, security event, security log, security operations, false positive, triage, escalat

## SKILLS TO LIST (concrete names a candidate can list for each item above)
Used to suggest what to put in a skills section. Names without a star appear in the job postings. Names with a star are practitioner-added and not seen in postings. Pending review.
Skills to list for MH1: Splunk, Microsoft Sentinel, IBM QRadar, Elastic, Wazuh, ArcSight, LogRhythm
Skills to list for MH2: Alert triage, Incident response, Runbooks and playbooks, Escalation notes
Skills to list for MH3: OWASP Top 10, CIA triad, Common attack types, Malware types
Skills to list for MH4: ServiceNow, Jira, BMC Remedy, Incident reporting, Shift handover notes
Skills to list for MH5: Windows event logs, Linux syslog, Sysmon, Log analysis
Skills to list for MH6: Wireshark, Subnetting, TCP/IP, Cisco Packet Tracer*
Skills to list for MH8: CrowdStrike, Microsoft Defender, SentinelOne, Palo Alto firewalls, Snort*, Suricata*
Skills to list for MH9: Linux, Windows, Windows Event Viewer*, Ubuntu*
Skills to list for SP1: Python, Bash, PowerShell
Skills to list for SP3: Nessus, Qualys, OpenVAS, Nmap
Skills to list for NH1: MITRE ATT&CK
Skills to list for NH2: Splunk SPL, Sentinel KQL, Atomic Red Team, Sigma*
Skills to list for NH3: TryHackMe, Hack The Box, LetsDefend, CyberDefenders, Security Onion
Skills to list for NH4: AWS, Azure, GCP, CloudTrail
Skills to list for NH6: VirusTotal, AbuseIPDB, MISP*
Skills to list for NH7: Microsoft Entra ID, MFA, Conditional Access
Skills to list for NH8: Email header analysis, SPF DKIM and DMARC, Proofpoint, Mimecast
Skills to list for NH9: ISO 27001, NIST, SOC 2
Skills to list for NH10: Disk imaging, Autopsy*, Volatility*
Skills to list for NH11: Splunk SPL, Sentinel KQL
Skills to list for NH12: Windows event IDs, Sysmon
Skills to list for NH13: NIST SP 800-61

## PRACTITIONER-ADDED (pending review)
- [PA1] Certification ladder for a fresher: entry level is Security+, ISC2 CC or the Google Cybersecurity Certificate; a SOC-focused next step is CySA+, SC-200, Splunk Core Certified User or BTL1; professional level is GCIH, GSEC and later CISSP. Postings rarely ask for professional-level certifications: CISSP, GCIH or GSEC appear in 4 of 28 (practitioner-added, pending review)
- [PA2] Experience relevance: judge each internship or job entry by which SOC items it shows, such as monitoring, triage, logs, documentation, vulnerability work or networking. An offensive security or unrelated entry still counts for the items it shows, and should be flagged when it shows none (practitioner-added, pending review)
- [PA3] Weak skills-section signals: buzzwords with no tool or context such as "AI" or "cybersecurity", basic office tools, and tools not used in security operations. Each listed skill should map to an item here or be flagged (practitioner-added, pending review)

## Tool names
No single SIEM product is required. Named in postings: Splunk 7, Microsoft Sentinel 7, QRadar 6, ArcSight 2, LogRhythm 2, Wazuh 2, plus single mentions of McAfee ESM, Rapid7 InsightIDR, Securonix, USM Anywhere, ELK and in-house platforms. EDR products named: CrowdStrike 4, SentinelOne 3, Microsoft Defender 3. Treat product names as examples of the concept, never as a gap by themselves.

## Fix ideas (practitioner-added, pending review)
- For MH1, MH2, MH4: work through the TryHackMe SOC Level 1 path, or triage sample alerts in a free SIEM such as Splunk Free or Elastic, and write each case up as a short ticket-style note.
- For SP2: CompTIA Security+, ISC2 CC or the Google Cybersecurity Certificate first, then CySA+ or SC-200. Listing "in progress" on a resume is fine.
- For SP1: a small Python script that parses sample logs and flags unusual entries, described with the tool, the input and the result.
- For NH4: AWS Cloud Practitioner or a free GCP fundamentals path.
- For MH8 and MH9: practise Linux commands and Windows event logs in a free lab VM, set up a free EDR or firewall lab, and list the tools in the skills section.
- For vague resume bullets: say which tool, what data, what was found, and what was done about it.
