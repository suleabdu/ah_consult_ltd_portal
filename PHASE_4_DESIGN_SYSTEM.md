# AH STUDENT HUB — Phase 4 Design System & Workflow Hardening

## Design direction

**AH Minimal Academic**: quiet professionalism, generous spacing, white surfaces, light-gray canvas, black navigation/text and the existing AH Consult orange used only as the action/accent colour.

The goal is to make the platform feel like one product instead of separate pages.

### Palette
- Primary orange: `#EA580C`
- Secondary orange: `#F97316`
- Deep orange: `#C2410C`
- Ink: `#171717`
- Canvas: `#F6F6F5`
- Borders: `#E4E4E7`
- White surfaces: `#FFFFFF`

## What changed

1. Added `frontend/css/ah-design-system.css` as the shared visual layer.
2. Applied the layer to the student, tutor, admin, application and authentication pages.
3. Added consistent focus states, responsive cards, tables, buttons, forms, modals, status pills and question-builder surfaces.
4. Added a small dependency-free `frontend/js/ah-ux.js` for accessibility enhancements and keyboard-friendly modal dismissal.
5. Upgraded the student dashboard with an academic-journey progress surface.
6. Upgraded assessment questions with per-question `File Required` support.
7. Students are prompted for a Drive/file link when a question explicitly requires one.
8. Server-side assessment and assignment validation now enforces mandatory questions and per-question file requirements.
9. Fixed the previous assessment JSON-array validation bug in `submit_assessment`.
10. Kept the 40/30/30 grading model and existing course/category presentation.

## Question import format

The first worksheet should contain exactly these logical columns:

`Question | Options | Mandatory | File Required`

- One question per row.
- Multiple-choice options are separated with `|`.
- Leave Options blank for an open-answer question.
- Mandatory: `Yes` or `No`.
- File Required: `Yes` or `No`.

Example:

`What is BIM? | Building Information Modelling|Business Information Model|Basic Interior Method | Yes | No`

## Deployment

Apply migrations in order through `014_phase4_hardening.sql` after 001–013. Test in staging before production.
