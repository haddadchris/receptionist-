import { config } from "@fekerte/core/config";
import { requireBusiness } from "@/lib/auth/current";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/stat";
import { CallSimulator } from "@/components/voice/call-simulator";

export const metadata = { title: "Call simulator" };

async function voiceCapabilities(): Promise<{ audio: boolean; reachable: boolean }> {
  try {
    const res = await fetch(`${config.voiceUrl}/browser/capabilities`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    const data = (await res.json()) as { audio?: boolean };
    return { audio: !!data.audio, reachable: true };
  } catch {
    return { audio: false, reachable: false };
  }
}

export default async function VoiceTestPage() {
  const ctx = await requireBusiness();
  const { t } = await getT();
  const caps = await voiceCapabilities();
  const publicVoiceUrl = process.env.NEXT_PUBLIC_VOICE_URL ?? config.voiceUrl;
  return (
    <div>
      <PageHeader title={t("voice.testTitle")} description={t("voice.testHint")} />
      {!caps.reachable ? (
        <p className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" dir="ltr">
          Voice server not reachable at {config.voiceUrl} — start it with <code>pnpm dev</code> (or <code>pnpm --filter @fekerte/voice dev</code>).
        </p>
      ) : null}
      <CallSimulator voiceUrl={publicVoiceUrl} defaultLanguage={ctx.business.defaultLanguage} audioAvailable={caps.audio} />
    </div>
  );
}
