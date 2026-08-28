'use client';

import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { z } from "zod";
import { AlertCircle, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { ROUTES } from "@/config/constants";
import { useToast } from "@/hooks/use-toast";
import { usePasswordStrength, type PasswordStrength } from "@/hooks/use-password-strength";
import { VimobLoader } from "@/components/shared/loading";
import { supabase } from "@/integrations/supabase/client";
import { getFriendlyErrorMessage } from "@/lib/error-handler";
import { settingsAPI } from "@/lib/api/settings";
import { setVimobAPIAccessToken } from "@/lib/api/vimob-client";
import {
  capturePasswordRecoveryIntent,
  clearPasswordRecoveryEvidence,
  grantPasswordRecoveryProof,
  hasPasswordRecoveryProof,
  isPasswordRecoveryAccessToken,
  isPasswordRecoveryIdentityMatch,
  readPasswordRecoveryUrlEvidence,
} from "@/lib/auth/password-recovery";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

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
    password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

function readRecoveryHash() {
  if (typeof window === "undefined" || !window.location.hash) {
    return null;
  }

  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function cleanRecoveryUrl() {
  if (typeof window === "undefined") return;

  window.history.replaceState({}, "", ROUTES.RESET_PASSWORD);
}

function getRecoveryExitPath(next: string | null) {
  return next === ROUTES.SIGNUP ? ROUTES.SIGNUP : ROUTES.LOGIN;
}

async function leavePasswordRecovery(destination: string) {
  if (typeof window === "undefined") return;

  clearPasswordRecoveryEvidence(window.sessionStorage);
  setVimobAPIAccessToken(null, null);

  try {
    const { data } = await supabase.auth.getSession();
    if (isPasswordRecoveryAccessToken(data.session?.access_token)) {
      await supabase.auth.signOut({ scope: "local" });
    }
  } finally {
    window.location.replace(destination);
  }
}
function passwordErrorMessage(error: unknown) {
  return getFriendlyErrorMessage(error);
}

function authValidationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.toLowerCase().includes("expired") || message.toLowerCase().includes("invalid")) {
    return "Este link de recuperação expirou ou já foi usado. Solicite um novo link para redefinir sua senha.";
  }

  return "Não foi possível validar este link de recuperação. Solicite um novo link e tente novamente.";
}

function isExpectedRecoveryValidationError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code).toLowerCase()
      : "";

  return (
    name === "AuthPKCECodeVerifierMissingError" ||
    code === "flow_state_not_found" ||
    code === "bad_code_verifier" ||
    code === "otp_expired" ||
    message.includes("pkce code verifier") ||
    message.includes("expired") ||
    message.includes("invalid")
  );
}

export default function ResetPasswordScreen() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailNotificationSent, setEmailNotificationSent] = useState<boolean | null>(null);
  const recoveryUserIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    let mounted = true;
    let establishedUserId: string | null = null;

    if (searchParams.get("cancel") === "1") {
      void leavePasswordRecovery(getRecoveryExitPath(searchParams.get("next")));
      return () => {
        mounted = false;
      };
    }

    const markReady = (session: Session) => {
      if (!mounted) return;
      establishedUserId = session.user.id;
      recoveryUserIdRef.current = session.user.id;
      setRecoveryState("ready");
      setValidationMessage(null);
    };

    const markInvalid = (message: string) => {
      if (!mounted) return;
      establishedUserId = null;
      recoveryUserIdRef.current = null;
      setRecoveryState("invalid");
      setValidationMessage(message);
    };

    const markReadyFromRecordedRecovery = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session || !isPasswordRecoveryAccessToken(session.access_token)) return false;
      if (!hasPasswordRecoveryProof(window.sessionStorage, session.user.id)) return false;

      cleanRecoveryUrl();
      markReady(session);
      return true;
    };

    const authorizeVerifiedRecoverySession = (session: Session) => {
      if (!isPasswordRecoveryAccessToken(session.access_token)) {
        clearPasswordRecoveryEvidence(window.sessionStorage);
        markInvalid("Esta sessão não é uma recuperação de senha válida. Solicite um novo link.");
        return false;
      }

      grantPasswordRecoveryProof(window.sessionStorage, session.user.id);
      cleanRecoveryUrl();
      markReady(session);
      return true;
    };

    const establishRecoverySession = async () => {
      if (mounted) {
        setRecoveryState("checking");
        setValidationMessage(null);
      }

      const recoveryUrl = new URL(window.location.href);
      const evidence = readPasswordRecoveryUrlEvidence(recoveryUrl);
      capturePasswordRecoveryIntent(window.sessionStorage, recoveryUrl);
      const hashParams = readRecoveryHash();
      const hashError = hashParams?.get("error_description") || hashParams?.get("error");

      if (hashError) {
        clearPasswordRecoveryEvidence(window.sessionStorage);
        cleanRecoveryUrl();
        markInvalid(hashError);
        return;
      }

      try {
        if (evidence.kind === "pkce") {
          const { data, error } = await supabase.auth.exchangeCodeForSession(evidence.code);
          if (error) throw error;
          // auth-js returns redirectType at runtime for PKCE exchanges, although
          // AuthTokenResponse currently omits it from the public declaration.
          if (!("redirectType" in data) || data.redirectType !== "recovery" || !data.session) {
            throw new Error("Invalid password recovery redirect type");
          }

          authorizeVerifiedRecoverySession(data.session);
          return;
        }

        if (evidence.kind === "token_hash") {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: evidence.tokenHash,
            type: "recovery",
          });
          if (error) throw error;
          if (!data.session) throw new Error("Missing password recovery session");

          authorizeVerifiedRecoverySession(data.session);
          return;
        }

        if (evidence.kind === "implicit") {
          const { data, error } = await supabase.auth.setSession({
            access_token: evidence.accessToken,
            refresh_token: evidence.refreshToken,
          });
          if (error) throw error;
          if (!data.session) throw new Error("Missing password recovery session");

          authorizeVerifiedRecoverySession(data.session);
          return;
        }

        if (await markReadyFromRecordedRecovery()) return;
        if (establishedUserId) return;

        markInvalid("Este link de recuperação não é mais válido. Solicite um novo link de redefinição de senha.");
      } catch (error) {
        if (establishedUserId) return;
        if (await markReadyFromRecordedRecovery()) return;

        if (!isExpectedRecoveryValidationError(error)) {
          console.error("Error validating password recovery session:", error);
        }
        clearPasswordRecoveryEvidence(window.sessionStorage);
        cleanRecoveryUrl();
        markInvalid(authValidationErrorMessage(error));
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY" && session) {
        authorizeVerifiedRecoverySession(session);
      }
    });

    void establishRecoverySession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const parsed = resetSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.errors.forEach((error) => {
        if (error.path[0]) {
          fieldErrors[String(error.path[0])] = error.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    if (!passwordStrength.isValid) {
      setErrors({ password: "A senha não atende aos critérios mínimos de segurança" });
      return;
    }

    setLoading(true);
    try {
      const expectedUserId = recoveryUserIdRef.current;
      const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
      ]);
      if (userError) throw userError;
      if (sessionError) throw sessionError;

      if (!isPasswordRecoveryIdentityMatch(
        expectedUserId,
        userData.user?.id,
        sessionData.session?.user.id,
      ) || !sessionData.session || !isPasswordRecoveryAccessToken(sessionData.session.access_token)) {
        const message = "A sessão de recuperação mudou ou expirou. Solicite um novo link para proteger sua conta.";
        recoveryUserIdRef.current = null;
        clearPasswordRecoveryEvidence(window.sessionStorage);
        cleanRecoveryUrl();
        setRecoveryState("invalid");
        setValidationMessage(message);
        toast({
          title: "Sessão de recuperação inválida",
          description: message,
          variant: "destructive",
        });
        if (isPasswordRecoveryAccessToken(sessionData.session?.access_token)) {
          void supabase.auth.signOut({ scope: "local" });
        }
        return;
      }

      setVimobAPIAccessToken(sessionData.session.access_token, sessionData.session.user.id);
      const result = await settingsAPI.changePassword({
        password,
        source: "recovery",
      });

      if (result?.allowed === false) {
        const message = result.message || "Não foi possível alterar sua senha agora.";
        setErrors({ password: message });
        toast({
          title: "Alteração bloqueada",
          description: message,
          variant: "destructive",
        });
        return;
      }

      const notificationSent = result.emailNotificationSent === true;
      setEmailNotificationSent(notificationSent);
      setRecoveryState("success");
      setPassword("");
      setConfirmPassword("");
      recoveryUserIdRef.current = null;
      clearPasswordRecoveryEvidence(window.sessionStorage);

      toast({
        title: "Senha alterada com sucesso",
        description:
          notificationSent
            ? "Enviamos um aviso de segurança para o seu e-mail."
            : "A senha foi alterada, mas não conseguimos confirmar o envio do aviso por e-mail.",
      });

      try {
        const { error: globalSignOutError } = await supabase.auth.signOut({ scope: "global" });
        if (globalSignOutError) {
          console.error("Error revoking sessions after password reset:", globalSignOutError);
          await supabase.auth.signOut({ scope: "local" });
        }
      } catch (signOutError) {
        console.error("Error signing out after password reset:", signOutError);
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch (localSignOutError) {
          console.error("Error clearing the local recovery session:", localSignOutError);
        }
      } finally {
        setVimobAPIAccessToken(null, null);
      }

      setTimeout(() => window.location.replace(`${ROUTES.LOGIN}?passwordReset=success`), 1600);
    } catch (error) {
      const message = passwordErrorMessage(error);
      toast({
        title: "Erro ao alterar senha",
        description: message,
        variant: "destructive",
      });
      setErrors({ password: message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      {recoveryState !== "success" ? (
        <header className="mb-8 text-left lg:mb-10">
          <h1 className="text-[20px] font-normal text-[var(--app-text-primary)]">
            {recoveryState === "ready" ? "Defina sua nova senha" : "Recuperar senha"}
          </h1>
          <p className="mt-1.5 text-[12px] font-light text-[var(--app-text-tertiary)]">
            {recoveryState === "ready" ? "Defina sua nova senha de acesso" : "Recuperação de senha"}
          </p>
        </header>
      ) : null}

      {recoveryState === "checking" ? (
        <div className="flex min-h-[260px] items-center justify-center">
          <VimobLoader size="lg" label="Validando acesso..." />
        </div>
      ) : null}

      {recoveryState === "invalid" ? (
        <div className="space-y-6">
          <div className="rounded-[6px] bg-primary/10 p-4 text-[var(--app-text-primary)]">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-[13px] font-medium">Link inválido ou expirado</p>
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
        <div className="space-y-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[6px] bg-primary/60 text-white">
            <Check className="h-6 w-6" />
          </div>

          <div className="space-y-3">
            <h1 className="text-[20px] font-normal text-[var(--app-text-primary)]">
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
        <form method="post" onSubmit={handleSubmit} className="space-y-5" aria-busy={loading}>
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
                placeholder="Mínimo 8 caracteres"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : undefined}
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
              <div className="space-y-2">
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
