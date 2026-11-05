import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/auth-forms";
import { getT } from "@/i18n/server";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  const { t } = await getT();
  return (
    <AuthShell title={t("auth.signupTitle")} subtitle={t("auth.signupSubtitle")}>
      <SignupForm />
    </AuthShell>
  );
}
