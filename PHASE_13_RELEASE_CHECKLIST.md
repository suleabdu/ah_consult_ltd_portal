# Phase 13 Release Checklist

## A. Frontend
- [ ] `python3 scripts/phase13_frontend_audit.py` passes
- [ ] all internal routes resolve
- [ ] clean URLs resolve on Vercel/Netlify
- [ ] `.html` source routes resolve on GitHub/static hosting
- [ ] 404 fallback preserves query/hash
- [ ] new student renders immediately after sign-in
- [ ] Continue works
- [ ] Back works
- [ ] wizard step navigation works
- [ ] header controls have sufficient contrast
- [ ] mobile navigation works

## B. Student
- [ ] account creation
- [ ] email confirmation behavior
- [ ] sign-in/sign-out
- [ ] application creation
- [ ] details save
- [ ] course selection
- [ ] payment verification
- [ ] preview/confirmation
- [ ] application submission
- [ ] admission routing
- [ ] portal
- [ ] assignments
- [ ] lectures
- [ ] exams
- [ ] published results only
- [ ] profile/password reset

## C. Tutor / Academic
- [ ] tutor authentication
- [ ] assigned-course restriction
- [ ] submission review
- [ ] grading
- [ ] result revision
- [ ] publication/locking
- [ ] legacy result review

## D. Admin / Finance
- [ ] staff authentication
- [ ] applications
- [ ] payment review
- [ ] admissions
- [ ] deferments
- [ ] course additions
- [ ] lecturer management
- [ ] Student 360
- [ ] audit center
- [ ] release readiness

## E. Data / Integrations
- [ ] Supabase source-of-truth counts reconciled
- [ ] Google Sheets mirror counts reconciled
- [ ] no pending/retry-exhausted sheet jobs
- [ ] communication queue healthy
- [ ] document queue healthy
- [ ] catalog matches authoritative 18-row set

## F. Production
- [ ] staging E2E green
- [ ] migration ledger reviewed
- [ ] backups verified
- [ ] provider/webhook secrets verified
- [ ] Auth redirect URLs verified
- [ ] deployment rollback point recorded
- [ ] release owner sign-off
