"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { safeNext } from "@/lib/next-path";

export async function signInWithEmail(_prevState, formData) {
  const email = String(formData.get("email") || "");
  const { error } = await auth.signIn.email({
    email,
    password: String(formData.get("password") || ""),
  });
  const next = safeNext(String(formData.get("next") || ""));
  if (error) {
    // email not verified yet (when the Neon Console REQUIRES verification): Neon Auth has just
    // sent a new code - go and enter it
    if (/verif/i.test(error.message || "") || error.code === "EMAIL_NOT_VERIFIED") {
      redirect(`/auth/verify-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
    }
    return { error: error.message || "Sign-in failed" };
  }
  redirect(next);   // back to the page they asked for
}
