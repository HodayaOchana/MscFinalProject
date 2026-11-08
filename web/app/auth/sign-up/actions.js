"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth/server";

// The consent boxes are checked HERE as well (not only by the browser). The
// choices are saved to the database right after, on the first page the new
// user opens (components/ConsentGate.js reads the short-lived bb_consent
// cookie set below and sends it to POST /api/me/consents) - at this moment the
// user has no profile row in our database yet.
export async function signUpWithEmail(_prevState, formData) {
  if (formData.get("age16") !== "on") return { error: "You must be 16 or older to use BookBridge." };
  if (formData.get("terms") !== "on") return { error: "Please agree to the Terms of Use and the Privacy Policy." };
  const email = String(formData.get("email") || "").trim();
  const { data, error } = await auth.signUp.email({
    name: String(formData.get("name") || ""),
    email,
    password: String(formData.get("password") || ""),
  });
  if (error) return { error: error.message || "Sign-up failed" };
  (await cookies()).set("bb_consent", JSON.stringify({ research: formData.get("research") === "on" }), {
    path: "/",
    maxAge: 60 * 30, // 30 minutes - only until the first page saves it
    sameSite: "lax",
  });
  // The Neon Console REQUIRES a verified email: no session yet - enter the code from the email first
  if (data && "token" in data && !data.token) redirect(`/auth/verify-email?email=${encodeURIComponent(email)}&next=/onboarding/genres`);
  redirect("/onboarding/genres"); // otherwise: in now, the pop-up asks to verify (components/VerifyEmailGate.js)
}
