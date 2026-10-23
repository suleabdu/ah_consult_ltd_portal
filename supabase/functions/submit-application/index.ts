/* =============================================================================
   SETUP GUIDE  -  supabase/functions/submit-application/index.ts
=============================================================================
WHAT IT IS
   Validates the application form (including education, occupation, skills and laptop questions) and assigns the Student ID.

WHERE THIS FILE GOES
   supabase/functions/submit-application/index.ts
   The file MUST be named index.ts. Its folder name (submit-application) is the function name.
   Run every command below from the PROJECT ROOT (the folder that CONTAINS the "supabase" folder).
   Its helpers live in supabase/functions/_shared/ (lib.ts, crypto.ts, pay.ts). Keep that folder exactly there.

ONE-TIME PREPARATION (skip if already done)
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF      (the part of your project URL before .supabase.co)

DEPLOY
   supabase functions deploy submit-application
   (Normal deploy. Signed-in users reach it with their login token.)
   "Docker is not running"? Start Docker Desktop, or update the Supabase CLI and add  --use-api  to the command.

SECRETS NEEDED   (supabase secrets set NAME=value   or   Dashboard > Edge Functions > Secrets)
   None.

DATABASE NEEDED
   Migrations 001 to 004.

HOW TO TEST
   Pay (or approve the payment), complete the form and submit. A Student ID like AHCT2610NNNN appears.

COMMON PROBLEMS
   "Payment has not been confirmed yet" = the application status is not paid yet.
   ============================================================================= */

// Final step: validate form + passport, assign Student ID, mark 'submitted'.
import { admin, json, safe, userFrom } from "../_shared/lib.ts";
import { kickSheetSync } from "../_shared/sync.ts";
Deno.serve(safe(async (req) => {
  const user = await userFrom(req); if (!user) return json({ error: "Please sign in again." }, 401);
  const { applicationId, form, passportPath } = await req.json();
  const e: Record<string, string> = {};
  if (!form?.surname?.trim()) e.surname = "Enter your surname.";
  if (!form?.firstName?.trim()) e.firstName = "Enter your first name.";
  if (!/^(\+234|0)[789][01]\d{8}$/.test((form?.phone ?? "").replace(/\s/g, ""))) e.phone = "Enter a valid Nigerian phone number.";
  if (!form?.dob) e.dob = "Enter your date of birth.";
  if (!form?.gender) e.gender = "Select your gender.";
  if (!form?.address?.trim()) e.address = "Enter your address.";
  if (!form?.state) e.state = "Select your state.";
  const EDU = ["Primary", "Secondary", "Bachelor Degree", "Masters Degree", "Ph.D Holder"], OCC = ["Civil Servant", "Private Worker", "Student"], BAT = ["3 Hours and Above", "Less than 3 hours", "Desktop"];
  if (!EDU.includes(form?.education)) e.education = "Select your education level.";
  if (!OCC.includes(form?.occupation)) e.occupation = "Select your occupation.";
  if (!form?.skills?.trim() || form.skills.length > 300) e.skills = "Tell us your skills (up to 300 characters).";
  if (!["Yes", "No"].includes(form?.laptop)) e.laptop = "Do you have a laptop?";
  else if (form.laptop === "Yes" && !BAT.includes(form?.battery)) e.battery = "Select your laptop battery duration.";
  if (form?.laptop === "No") form.battery = "Not applicable";
  if (!passportPath) e.passport = "Upload your passport photograph.";
  if (Object.keys(e).length) return json({ errors: e }, 422);
  const db = admin();
  const { data: app } = await db.from("applications").select("*").eq("id", applicationId).eq("user_id", user.id).single();
  if (!app) return json({ error: "Application not found." }, 404);
  if (app.status === "submitted") return json({ studentId: app.student_id }); // idempotent
  if (app.status !== "paid") return json({ error: "Payment has not been confirmed yet." }, 402);
  if (!passportPath.startsWith(`${user.id}/${app.id}/`)) return json({ error: "Invalid passport file." }, 400);
  const { data: id } = await db.rpc("next_student_id", { p_intake: app.intake_id });
  await db.from("applications").update({ status: "submitted", form_data: form, passport_path: passportPath, student_id: id, submitted_at: new Date().toISOString() }).eq("id", app.id);
  await kickSheetSync();
  return json({ studentId: id });
}));
