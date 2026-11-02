'use client';

import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { AlertCircle, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { ROUTES } from "@/config/constants";
import { useToast } from "@/hooks/use-toast";
import { usePasswordStrength, type PasswordStrength } from "@/hooks/use-password-strength";
import { VimobLoader } from "@/components/shared/loading";
import { supabase } from "@/lib/supabase/client";
import { getFriendlyErrorMessage } from "@/lib/error-handler";
import { settingsAPI } from "@/lib/api/settings";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { setVimobAPIAccessToken } from "@/lib/api/vimob-client";
import { PASSWORD_POLICY, strongPasswordSchema } from "@/lib/validation/password";
import { getGlobalSignOutSessionId } from "@/lib/auth/global-sign-out";
import { usePasswordRecoverySession } from "@/hooks/auth/use-password-recovery-session";
import { usePasswordRecoveryForm } from "@/hooks/auth/use-password-recovery-form";
import type { PasswordRecoveryGuard } from "@/lib/auth/password-recovery-exit";
import { isPasswordRecoveryAccessToken, isPasswordRecoveryIdentityMatch } from "@/lib/auth/password-recovery";

const STRENGTH_COLORS: Record<PasswordStrength["level"], string> = {
  "very-weak": "bg-red-500",
  weak: "bg-orange-500",
  fair: "bg-yellow-500",
  good: "bg-lime-500",
  strong: "bg-green-500",
};

const STRENGTH_LABELS: Record<PasswordStrength["level"], string> = {
  "very-weak": "Muito fraca",
  weak: "Fraca",
  fair: "Razoável",
  good: "Boa",
  strong: "Forte",
};

const resetSchema = z
  .object({
    password: strongPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

function passwordErrorMessage(error: unknown) {
  return getFriendlyErrorMessage(error);
}

export default function ResetPasswordScreen() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { recoveryState, setRecoveryState, validationMessage, setValidationMessage,
    recoveryIdentity, captureGuard, captureRequest, leavePasswordRecovery, finishPasswordRecovery,
  } = usePasswordRecoverySession(searchParams);
  const { loading, setLoading, showPassword, setShowPassword, showConfirmPassword, setShowConfirmPassword,
    password, setPassword, confirmPassword, setConfirmPassword, errors, setErrors,
    emailNotificationSent, setEmailNotificationSent,
  } = usePasswordRecoveryForm(recoveryIdentity);
  const submissionInFlightRef = useRef<PasswordRecoveryGuard | null>(null);
  const recoveryHeadingRef = useRef<HTMLHeadingElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  const passwordStrength = usePasswordStrength(password);
  const passwordMismatch = Boolean(confirmPassword && password !== confirmPassword);

  const submitDisabled = useMemo(
    () =>
      loading ||
      !password ||
      !confirmPassword ||
      !passwordStrength.isValid ||
      password !== confirmPassword,
    [confirmPassword, loading, password, passwordStrength.isValid],
  );

  const recoveryAnnouncement = recoveryState === "checking"
    ? "Validando o link de recuperação."
    : recoveryState === "ready"
      ? "Link validado. Defina sua nova senha."
      : recoveryState === "invalid"
        ? validationMessage || "Não foi possível validar o link de recuperação."
          : recoveryState === "incomplete"
            ? validationMessage || "Não conseguimos confirmar a conclusão da troca de senha. Solicite um novo link."
           : "Senha alterada com sucesso. Redirecionando para o login.";

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const heading = recoveryState === "success"
        ? successHeadingRef.current
        : recoveryHeadingRef.current;
      heading?.focus();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [recoveryState]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlightRef.current?.isCurrent()) return;
    setErrors({});
    const parsed = resetSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((error) => {
        if (error.path[0]) fieldErrors[String(error.path[0])] = error.message;
      });
      setErrors(fieldErrors);
      return;
    }
    if (!passwordStrength.isValid) {
      setErrors({ password: "A senha não atende aos critérios mínimos de segurança" });
      return;
    }
    const guard = captureGuard();
    if (!guard?.isCurrent() || !guard.expectedUserId || !guard.expectedSessionId) {
      setErrors({ password: "A sessão de recuperação mudou ou expirou. Solicite um novo link." });
      return;
    }
    const request = captureRequest(guard);
    submissionInFlightRef.current = guard;
    setLoading(true);
    let passwordChangeAttempted = false;
    try {
      const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] = await Promise.all([
        supabase.auth.getUser(), supabase.auth.getSession(),
      ]);
      if (!guard.isCurrent()) return;
      if (userError) throw userError;
      if (sessionError) throw sessionError;
      if (!isPasswordRecoveryIdentityMatch(guard.expectedUserId, userData.user?.id, sessionData.session?.user.id)
        || !sessionData.session || !isPasswordRecoveryAccessToken(sessionData.session.access_token)
        || getGlobalSignOutSessionId(sessionData.session) !== guard.expectedSessionId) {
        setRecoveryState("invalid");
        setValidationMessage("A sessão de recuperação mudou ou expirou. Solicite um novo link para proteger sua conta.");
        return;
      }
      if (!guard.isCurrent()) return;
      setVimobAPIAccessToken(sessionData.session.access_token, sessionData.session.user.id);
      passwordChangeAttempted = true;
      const result = await settingsAPI.changePassword({ password, source: "recovery" }, null, {
        expectedUserId: guard.expectedUserId, expectedSessionId: guard.expectedSessionId, signal: request.signal,
      });
      if (!guard.isCurrent()) return;
      if (result?.allowed === false) {
        const message = result.message || "Não foi possível alterar sua senha agora.";
        setErrors({ password: message });
        toast({ title: "Alteração bloqueada", description: message, variant: "destructive" });
        return;
      }
      if (result.sessionsRevoked !== true) {
        setRecoveryState("incomplete");
        setPassword("");
        setConfirmPassword("");
        await finishPasswordRecovery("unverified", guard);
        return;
      }
      const notificationSent = result.emailNotificationSent === true;
      setEmailNotificationSent(notificationSent);
      setRecoveryState("success");
      setPassword("");
      setConfirmPassword("");
      toast({ title: "Senha alterada com sucesso", description: notificationSent
        ? "Enviamos um aviso de segurança para o seu e-mail."
        : "A senha foi alterada, mas não conseguimos confirmar o envio do aviso por e-mail.",
      });
      await finishPasswordRecovery("success", guard);
    } catch (error) {
      if (!guard.isCurrent()) return;
      const message = passwordChangeAttempted
        ? error instanceof VimobAPIError && error.code === "password_update_unconfirmed_after_revocation"
          ? "A revogação das sessões foi aceita, mas não conseguimos confirmar se a nova senha foi salva. Solicite um novo link de recuperação."
          : error instanceof VimobAPIError && error.code === "password_session_revocation_unconfirmed"
            ? "A senha não foi atualizada porque não conseguimos confirmar a revogação das sessões. Solicite um novo link de recuperação."
            : "Não conseguimos confirmar a troca de senha com segurança. Solicite um novo link de recuperação."
        : passwordErrorMessage(error);
      if (passwordChangeAttempted) {
        setRecoveryState("incomplete");
        setValidationMessage(message);
        setPassword("");
        setConfirmPassword("");
      }
      // A delayed failure must never sign out or clear whichever SDK identity replaced this visit.
      toast({ title: "Erro ao alterar senha", description: message, variant: "destructive" });
      setErrors({ password: message });
    } finally {
      request.finish();
      if (submissionInFlightRef.current === guard) submissionInFlightRef.current = null;
      if (guard.isCurrent()) setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {recoveryAnnouncement}
      </p>

      {recoveryState !== "success" ? (
        <header className="mb-8 text-left lg:mb-10">
          <h1
            id="password-recovery-heading"
            ref={recoveryHeadingRef}
            tabIndex={-1}
            className="text-[20px] font-normal text-[var(--app-text-primary)] focus:outline-none"
          >
            {recoveryState === "ready"
              ? "Defina sua nova senha"
              : recoveryState === "invalid"
                ? "Link inválido ou expirado"
                : recoveryState === "incomplete"
                  ? "Não foi possível concluir"
                : "Recuperar senha"}
          </h1>
          <p className="mt-1.5 text-[12px] font-light text-[var(--app-text-tertiary)]">
            {recoveryState === "ready" ? "Defina sua nova senha de acesso" : "Recuperação de senha"}
          </p>
        </header>
      ) : null}

      {recoveryState === "checking" ? (
        <div
          className="flex min-h-[260px] items-center justify-center"
          aria-labelledby="password-recovery-heading"
        >
          <VimobLoader size="lg" label="Validando acesso..." />
        </div>
      ) : null}

      {recoveryState === "invalid" || recoveryState === "incomplete" ? (
        <div className="space-y-6" aria-labelledby="password-recovery-heading">
          <div className="rounded-[6px] bg-primary/10 p-4 text-[var(--app-text-primary)]">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-[13px] font-medium">
                  {recoveryState === "incomplete" ? "Não foi possível concluir" : "Link inválido ou expirado"}
                </p>
                <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  {validationMessage ||
                    "Solicite um novo link de redefinição de senha para continuar com segurança."}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void leavePasswordRecovery(ROUTES.LOGIN)}
            className="auth-primary-action h-12 w-full cursor-pointer rounded-[6px] text-[12px] font-light shadow-none outline-none transition-colors"
          >
            Voltar para o login
          </button>
        </div>
      ) : null}

      {recoveryState === "success" ? (
        <div
          className="space-y-6 text-center"
          aria-labelledby="password-recovery-success-heading"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[6px] bg-primary/60 text-white">
            <Check className="h-6 w-6" />
          </div>

          <div className="space-y-3">
            <h1
              id="password-recovery-success-heading"
              ref={successHeadingRef}
              tabIndex={-1}
              className="text-[20px] font-normal text-[var(--app-text-primary)] focus:outline-none"
            >
              Senha alterada com sucesso
            </h1>
            <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
              Você já pode entrar no Vimob crm usando a nova senha.
            </p>
            <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
              {emailNotificationSent === true
                ? "Enviamos um aviso de segurança para o seu e-mail."
                : "Não conseguimos confirmar o envio do aviso por e-mail agora."}{" "}
              Se não foi você, fale imediatamente com{" "}
              <a
                href="mailto:contato@vimobcrm.com.br"
                className="text-primary outline-none hover:opacity-80"
              >
                contato@vimobcrm.com.br
              </a>
              .
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-[12px] font-light text-[var(--app-text-tertiary)]">
            <ShieldCheck className="h-4 w-4" />
            Redirecionando para o login...
          </div>
        </div>
      ) : null}

      {recoveryState === "ready" ? (
        <form
          method="post"
          onSubmit={handleSubmit}
          className="space-y-5"
          aria-busy={loading}
          aria-labelledby="password-recovery-heading"
        >
          <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
            Escolha uma senha forte e diferente das que você usa em outros serviços.
          </p>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="block text-[13px] font-light text-[var(--app-text-primary)]"
            >
              Nova senha
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[var(--app-text-tertiary)]">
                <LockKeyhole className="h-4 w-4" />
              </span>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={loading}
                minLength={PASSWORD_POLICY.minLength}
                maxLength={PASSWORD_POLICY.maxLength}
                placeholder={`Mínimo ${PASSWORD_POLICY.minLength} caracteres`}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={[
                  "password-requirements",
                  errors.password ? "password-error" : null,
                ].filter(Boolean).join(" ")}
                className="auth-login-field h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-4 pl-11 pr-12 text-base text-[var(--app-text-primary)] shadow-none outline-none ring-0 transition-colors placeholder:text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-solid)] focus:ring-1 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                disabled={loading}
                className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-4 text-[var(--app-text-tertiary)] outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {password ? (
              <div id="password-requirements" className="space-y-2">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <div
                      key={item}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        item <= passwordStrength.score
                          ? STRENGTH_COLORS[passwordStrength.level]
                          : "bg-[var(--app-border)]"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                  Força:{" "}
                  <span className="font-medium text-[var(--app-text-secondary)]">
                    {STRENGTH_LABELS[passwordStrength.level]}
                  </span>
                </p>
                {passwordStrength.feedback.length > 0 && !passwordStrength.isValid ? (
                  <ul className="space-y-1 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                    {passwordStrength.feedback.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {errors.password ? (
              <p
                id="password-error"
                className="text-[12px] font-light leading-[18px] text-primary"
                role="alert"
              >
                {errors.password}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="confirmPassword"
              className="block text-[13px] font-light text-[var(--app-text-primary)]"
            >
              Confirmar nova senha
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[var(--app-text-tertiary)]">
                <LockKeyhole className="h-4 w-4" />
              </span>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                disabled={loading}
                minLength={PASSWORD_POLICY.minLength}
                maxLength={PASSWORD_POLICY.maxLength}
                placeholder="Repita a senha"
                aria-invalid={Boolean(errors.confirmPassword || passwordMismatch)}
                aria-describedby={
                  errors.confirmPassword || passwordMismatch ? "confirm-password-error" : undefined
                }
                className="auth-login-field h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-4 pl-11 pr-12 text-base text-[var(--app-text-primary)] shadow-none outline-none ring-0 transition-colors placeholder:text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-solid)] focus:ring-1 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((current) => !current)}
                disabled={loading}
                className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-4 text-[var(--app-text-tertiary)] outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {errors.confirmPassword || passwordMismatch ? (
              <p
                id="confirm-password-error"
                className="text-[12px] font-light leading-[18px] text-primary"
                role="alert"
              >
                {errors.confirmPassword || "As senhas não coincidem"}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={submitDisabled}
            className="auth-primary-action flex h-12 w-full cursor-pointer items-center justify-center rounded-[6px] text-[12px] font-light shadow-none outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55"
          >
            {loading ? <VimobLoader size="sm" className="mr-2" label="Alterando senha..." /> : null}
            Alterar senha
          </button>

          <footer className="text-center text-[13px] font-light">
            <button
              type="button"
              onClick={() => void leavePasswordRecovery(ROUTES.LOGIN)}
              className="inline-flex min-h-11 cursor-pointer items-center py-2 text-primary outline-none transition-opacity hover:opacity-80"
            >
              Voltar para o login
            </button>
          </footer>
        </form>
      ) : null}
    </div>
  );
}
