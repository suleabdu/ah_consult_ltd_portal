# Global panel readiness control register

## Purpose and status

This register separates controls demonstrable from source code from operational evidence that only AH Consult can approve or collect. It is a release gate, not a certification claim. A production or external-panel release is **not approved** until every `Required before release` item is evidenced, dated, and signed off by its named owner.

## Release gate

| Area | Source evidence now | Required before release | Accountable owner |
| --- | --- | --- | --- |
| Credential safety | Static validation and CI secret scan; committed examples contain placeholders only | Rotate every credential that may have appeared in an earlier archive; scan all Git history and external copies; record rotation date, key IDs and test result without recording secret values | System owner |
| Identity and access | RLS, role permissions, audit log and approval workflows are source-tested | Enforce staff MFA; review administrator/registrar accounts, access-code lifecycle and break-glass access; retain review evidence | Security owner |
| Application security | CSP/security headers, dependency lockfile, source checks, Deno/SQL/frontend CI tests | Independent staging penetration test, threat-model review, remediation acceptance and a clean final CI run | Technical lead |
| Data protection | Default-deny database posture, private document archive and read-only sheet mirror | Approve privacy notice, lawful basis, retention schedule, data-subject request process, processor register and cross-border transfer position | Privacy owner / counsel |
| Media privacy | Source records distinguish published gallery records from drafts | Complete the staged media-storage migration and verify that unapproved uploads are not publicly retrievable before using the workflow with personal images | Technical lead + data owner |
| Availability and recovery | Migration sequence, release runbook and outbox retry design | Prove restore from a recent encrypted backup into isolated staging; set RPO/RTO, monitoring/alert routing and incident contacts; retain the restoration log | Operations owner |
| Payments and integrations | Server-side amount verification, webhook guards and sandbox-oriented procedures | Provider sandbox sign-off, webhook replay/idempotency test, reconciliation process, supplier DPA and live-secret rotation | Finance + technical lead |
| Accessibility and international UX | Responsive source and automated DOM/static checks | WCAG 2.2 AA audit on representative devices/browsers, keyboard/screen-reader findings, language/date/currency review and remediation acceptance | Product owner |
| Brand and official documents | Governed templates and approval states are in source | Confirm brand assets, institutional identity, signatory policy and legal wording; do not issue official documents until approved | Institutional owner |

## Minimum evidence pack

Store evidence in a private governance location, not in this repository: final CI permalink, signed release approval, dependency/SBOM report, penetration-test summary, backup-restore record, access-review record, provider sandbox results, privacy/legal approvals, accessibility report, and incident exercise record. Redact personal data, access tokens and credentials.

## ISMS operating rhythm

| Cadence | Control activity |
| --- | --- |
| Each release | Clean working tree; independent review; CI green; production dependency audit; approved change ticket; rollback and communications plan |
| Monthly | Privileged-access review; audit-log sampling; dependency review; failed-worker/outbox review; certificate/domain expiry checks |
| Quarterly | Restore exercise; incident tabletop; supplier/security review; data-retention review; vulnerability remediation review |
| Annually and after material change | Risk assessment; policy approval; asset/data-flow inventory; staff security training; external security/accessibility reassessment |

## Acceptance decision

The panel should record one of three decisions: `approved for staging`, `approved for production with dated exceptions`, or `not approved`. A source-only review may support staging; it does not prove live configuration, backup recovery, legal approval, vendor assurance or incident readiness.

## Related material

- [Panel review guide](PANEL_REVIEW.md)
- [Security model and known limitations](../SECURITY.md)
- [Credential exposure response](SECURITY_INCIDENT_RESPONSE.md)
- [Operations runbook](RUNBOOK.md)
- [Dependency audit exception register](SECURITY_EXCEPTIONS.md)
