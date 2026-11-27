# HR and recruitment staging guide

This source update requires migrations 051, 052 and 053, in numerical order, after 001–050. Take a restorable backup and validate them on an isolated Supabase staging project before deploying the frontend. The new recruitment storage bucket is private. The application uses the existing protected communication worker and email provider for staff notices; confirm the sender, provider credentials and worker schedule separately.

An administrator can assign the built-in HR role and configure additional roles and dashboard modules. Existing sensitive workflows may also require specific institutional roles. Review every custom role against its intended tasks, and do not assume that a visible dashboard tab grants an action.

For staging acceptance, use synthetic staff and applicants to check role isolation; scheduled vacancy opening and closing; required questions, passport and attachment validation; applicant isolation and HR file access; HR activities and refresher resources; staff email delivery; and authentication with an enrolled authenticator. Check the website at mobile and desktop widths.

Authenticator enrollment is optional and the current challenge guards operate in the browser. They do **not** yet enforce a second factor for direct database, storage or Edge Function API requests. Do not treat this implementation as mandatory MFA until backend assurance checks, enrollment, recovery and lockout procedures have been designed and tested for every protected route.

Before production, establish a retention and orphan-upload cleanup policy, assess abuse controls for public applications, and verify the organization’s privacy notice and recruitment data handling. Do not test with actual candidates until those controls and the staging results are approved.
