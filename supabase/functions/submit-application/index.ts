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
  const dob=String(form?.dob||'');
  const birthday=/^\d{4}-\d{2}-\d{2}$/.test(dob)?new Date(dob+'T00:00:00Z'):new Date(NaN);
  const today=new Date(),cutoff=new Date(Date.UTC(today.getUTCFullYear()-16,today.getUTCMonth(),today.getUTCDate()));
  if(!Number.isFinite(birthday.getTime())||birthday.toISOString().slice(0,10)!==dob||birthday>cutoff) e.dob="Applicants must be at least 16 years old. Enter a valid date of birth.";
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
  // One transactional RPC performs allocation, validation and update atomically.
  const { data: id, error: finalizeError } = await db.rpc("finalize_paid_application", {
    p_app: app.id, p_form: form, p_passport: passportPath
  });
  if (finalizeError) {
    console.error("Finalization failed", finalizeError.message);
    return json({ error: "Your application could not be finalized. No additional student ID was issued. Please retry or contact admissions." }, 409);
  }
  await kickSheetSync().catch((error) => console.error("Sheet sync scheduled after submission", error));
  return json({ studentId: id });
}));
