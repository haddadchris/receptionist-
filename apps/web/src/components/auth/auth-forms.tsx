"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useT } from "@/i18n/client";
import { loginAction, magicLinkAction, signupAction } from "@/app/login/actions";

type State = { ok: true; redirectTo: string } | { ok: false; error: string; devLink?: string; info?: string } | null;

function useRedirectOnSuccess(state: State) {
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);
}

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<State, FormData>(loginAction, null);
  const [magic, magicAction, magicPending] = useActionState<State, FormData>(magicLinkAction, null);
  useRedirectOnSuccess(state);
  return (
    <div className="grid gap-5">
      <form action={action} className="grid gap-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label={t("auth.email")} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
        </Field>
        <Field label={t("auth.password")} htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
        </Field>
        {state && !state.ok && state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t("common.loading") : t("auth.signIn")}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("auth.or")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <form action={magicAction} className="grid gap-2">
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="flex gap-2">
          <Input name="email" type="email" placeholder={t("auth.email")} required dir="ltr" />
          <Button type="submit" variant="outline" disabled={magicPending}>
            {t("auth.magicLink")}
          </Button>
        </div>
        {magic && !magic.ok && magic.info ? <p className="text-sm text-success">{magic.info}</p> : null}
        {magic && !magic.ok && magic.error ? <p className="text-sm text-destructive">{magic.error}</p> : null}
        {magic && !magic.ok && magic.devLink ? (
          <p className="rounded-md bg-muted p-2 text-xs break-all">
            {t("auth.devMagicLink")}{" "}
            <a className="text-primary underline" href={magic.devLink}>
              {magic.devLink}
            </a>
          </p>
        ) : null}
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          {t("auth.signUp")}
        </Link>
      </p>
      <p className="text-center text-xs text-muted-foreground" dir="ltr">
        {t("auth.demoHint")}
      </p>
    </div>
  );
}

export function SignupForm() {
  const t = useT();
  const [state, action, pending] = useActionState<State, FormData>(signupAction, null);
  useRedirectOnSuccess(state);
  return (
    <form action={action} className="grid gap-4">
      <Field label={t("auth.name")} htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required minLength={2} />
      </Field>
      <Field label={t("auth.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </Field>
      <Field label={t("auth.password")} htmlFor="password" hint="8+">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} dir="ltr" />
      </Field>
      {state && !state.ok && state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("common.loading") : t("auth.signUp")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t("auth.signIn")}
        </Link>
      </p>
    </form>
  );
}
