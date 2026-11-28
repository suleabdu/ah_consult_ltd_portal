# Direct recruitment applications

Apply migration 058 after 001–057, then deploy the `recruitment-apply` Edge Function and the updated frontend. The guest form depends on both the migration and the function; deploying the frontend alone will not enable submissions. Configure `ALLOWED_ORIGINS` for the public website as for the other browser-facing functions.

In staging, publish an open position and submit a synthetic application without signing in. Include a CV, passport photograph, and question attachment when required; verify the answers and private attachments in the HR workspace. Also test missing required fields, invalid or oversized files, a closed position, and the unavailable-service message. Confirm that unauthorized visitors cannot read application records or files.

Guest email addresses are not verified by this flow. HR should verify applicants' contact information and review potential duplicate submissions; submission alone does not establish a candidate's identity. Monitor application volume and configure appropriate upstream anti-abuse controls for the deployment.
