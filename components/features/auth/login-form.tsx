"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/config/constants";
import {
  getPostLoginPathFromSearchParams,
  getSafePostLoginPath,
} from "@/lib/auth/post-login-redirect";
import { shouldWaitForPostLoginRouting } from "@/lib/auth/frontend-auth-reliability";
import { authAPI } from "@/lib/api/auth";

type FormMode = "login" | "recover";

const defaultPostLoginPath = DEFAULT_AUTHENTICATED_ROUTE;
const sensitiveLoginParams = ["email", "password", "senha", "pass", "pwd"];

function getCurrentRedirectPath() {
  if (typeof window === "undefined") {
    return defaultPostLoginPath;
  }

  const params = new URLSearchParams(window.location.search);
  return getPostLoginPathFromSearchParams(params, defaultPostLoginPath);
}

function sanitizeLoginUrl() {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  let changed = false;

  sensitiveLoginParams.forEach((param) => {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  });

  if (changed) {
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function getSelectOrganizationPath(redirectTo: string) {
  const safeRedirectTo = getSafePostLoginPath(redirectTo, defaultPostLoginPath);
  const params = new URLSearchParams({ redirectTo: safeRedirectTo });
  return `/select-organization?${params.toString()}`;
}

function EnvelopeIcon({ className = "text-white/40" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      className={className}
      aria-hidden="true"
    >
      <rect x="1.5" y="3.5" width="13" height="9" />
      <path d="M1.5 4.5L8 9.5L14.5 4.5" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        aria-hidden="true"
      >
        <path d="M1.5 8C1.5 8 3.5 3.5 8 3.5C12.5 3.5 14.5 8 14.5 8C14.5 8 12.5 12.5 8 12.5C3.5 12.5 1.5 8 1.5 8Z" />
        <circle cx="8" cy="8" r="2" />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden="true"
    >
      <path d="M2 2L14 14" />
      <path d="M6.5 6.5C6 7 5.75 7.5 5.75 8C5.75 9.25 6.75 10.25 8 10.25C8.5 10.25 9 10 9.5 9.5" />
      <path d="M1.5 8C1.5 8 3.5 3.5 8 3.5C9.25 3.5 10.35 3.85 11.25 4.4M14.5 8C14.5 8 12.5 12.5 8 12.5C7.15 12.5 6.35 12.3 5.65 11.95" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M11.25 3.75L6 9L11.25 14.25" />
      <path d="M6.75 9H15" />
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const {
    signIn,
    resetPassword,
    user,
    loading,
    authInitialized,
    organizationsLoaded,
    isInitializingOrg,
    isSuperAdmin,
    organization,
    userOrganizations,
  } = useAuth();
  const [formMode, setFormMode] = useState<FormMode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false);
  const [emailConfirmationPending, setEmailConfirmationPending] = useState(false);
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [confirmationResendMessage, setConfirmationResendMessage] = useState<string | null>(null);
  const [confirmationResendError, setConfirmationResendError] = useState<string | null>(null);
  const [pendingPostLoginPath, setPendingPostLoginPath] = useState<string | null>(null);
  const [routeAfterEmailConfirmation, setRouteAfterEmailConfirmation] = useState(false);

  const isRecoveringPassword = formMode === "recover";
  const textClass = "text-[var(--app-text-primary)]";
  const mutedTextClass = "text-[var(--app-text-tertiary)]";
  const paragraphTextClass = "text-[var(--app-text-secondary)]";
  const successTextClass = "text-emerald-600 dark:text-emerald-400";
  const separatorClass = "text-[var(--app-text-tertiary)]";
  const iconClass = "text-[var(--app-text-tertiary)]";
  const iconButtonClass =
    "text-[var(--app-text-tertiary)] hover:text-[var(--app-text-primary)] focus-visible:text-[var(--app-text-primary)]";
  const labelClass = `block text-[13px] font-light ${textClass}`;
  const inputClass =
    "auth-login-field h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-4 text-base text-[var(--app-text-primary)] shadow-none outline-none ring-0 transition-colors placeholder:text-[var(--app-text-secondary)] sm:text-sm focus:bg-[var(--app-surface-solid)] focus:ring-1 focus:ring-primary/40";
  const checkboxBorderClass =
    "border-[var(--app-border-strong)] peer-checked:border-primary peer-focus-visible:border-primary";

  useEffect(() => {
    sanitizeLoginUrl();
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    let messageTimer: number | undefined;
    let rememberedEmailTimer: number | undefined;

    try {
      const rememberedEmail = localStorage.getItem("remembered_email");
      if (rememberedEmail) {
        rememberedEmailTimer = window.setTimeout(() => {
          setEmail(rememberedEmail);
          setRememberMe(true);
        }, 0);
      }
    } catch {
      // Browser storage can be unavailable in restricted contexts.
    }

    if (url.searchParams.get("passwordReset") === "success") {
      url.searchParams.delete("passwordReset");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      messageTimer = window.setTimeout(() => {
        setRecoveryMessage("Senha alterada com sucesso. Entre usando sua nova senha.");
      }, 0);
    }

    const emailConfirmation = url.searchParams.get("emailConfirmation");
    if (emailConfirmation === "required" || emailConfirmation === "success") {
      url.searchParams.delete("emailConfirmation");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (emailConfirmation === "required") {
      messageTimer = window.setTimeout(() => {
        setEmailConfirmationPending(true);
        setRecoveryMessage("Confirme o link enviado ao seu e-mail antes de entrar.");
      }, 0);
    } else if (emailConfirmation === "success") {
      messageTimer = window.setTimeout(() => {
        setEmailConfirmationPending(false);
        setRecoveryMessage("Confirmação recebida. Estamos validando seu acesso.");
        setRouteAfterEmailConfirmation(true);
      }, 0);
    }

    return () => {
      if (messageTimer) window.clearTimeout(messageTimer);
      if (rememberedEmailTimer) window.clearTimeout(rememberedEmailTimer);
    };
  }, []);

  useEffect(() => {
    if (!routeAfterEmailConfirmation || loading || !authInitialized || user) return;
    const messageTimer = window.setTimeout(() => {
      setRecoveryMessage("Confirmação processada. Entre para continuar.");
    }, 0);
    return () => window.clearTimeout(messageTimer);
  }, [authInitialized, loading, routeAfterEmailConfirmation, user]);

  useEffect(() => {
    if (!routeAfterEmailConfirmation || !user || loading || !authInitialized) return;
    const routeTimer = window.setTimeout(() => {
      setPendingPostLoginPath(getCurrentRedirectPath());
    }, 0);
    return () => window.clearTimeout(routeTimer);
  }, [authInitialized, loading, routeAfterEmailConfirmation, user]);

  useEffect(() => {
    if (!pendingPostLoginPath) return;
    if (!user) return;
    if (shouldWaitForPostLoginRouting({
      authInitialized,
      authLoading: loading,
      isInitializingOrganization: isInitializingOrg,
      organizationsLoaded,
    })) return;

    const activeOrganizations = userOrganizations.filter((org) => org.is_active);

    if (isSuperAdmin) {
      router.replace(pendingPostLoginPath);
      return;
    }

    if (organization) {
      router.replace(pendingPostLoginPath);
      return;
    }

    if (!organizationsLoaded || isInitializingOrg) return;

    if (activeOrganizations.length === 1) {
      router.replace(pendingPostLoginPath);
      return;
    }

    router.replace(getSelectOrganizationPath(pendingPostLoginPath));
  }, [
    authInitialized,
    isInitializingOrg,
    isSuperAdmin,
    loading,
    organization,
    organizationsLoaded,
    pendingPostLoginPath,
    router,
    user,
    userOrganizations,
  ]);

  function showRecoveryForm() {
    setLoginError(null);
    setRecoveryError(null);
    setRecoveryMessage(null);
    setConfirmationResendMessage(null);
    setConfirmationResendError(null);
    setFormMode("recover");
  }

  function showLoginForm() {
    setLoginError(null);
    setRecoveryError(null);
    setRecoveryMessage(null);
    setFormMode("login");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    setLoginError(null);

    if (!email || !password) {
      setLoginError("Preencha e-mail e senha para entrar.");
      return;
    }

    setIsSubmittingLogin(true);
    let shouldKeepRouting = false;

    try {
      const { error } = await signIn(email, password);

      if (error) {
        const code = "code" in error ? String(error.code) : "";
        const requiresEmailConfirmation = code === "email_not_confirmed";
        setEmailConfirmationPending(requiresEmailConfirmation);
        setConfirmationResendMessage(null);
        setConfirmationResendError(null);
        setLoginError(
          requiresEmailConfirmation
            ? "Confirme o link enviado ao seu e-mail antes de entrar."
            : "E-mail ou senha inválidos. Confira os dados e tente novamente.",
        );
        return;
      }

      setEmailConfirmationPending(false);

      if (rememberMe) {
        try {
          localStorage.setItem("remembered_email", email);
        } catch {
          // Browser storage can be unavailable in restricted contexts.
        }
      } else {
        try {
          localStorage.removeItem("remembered_email");
        } catch {
          // Browser storage can be unavailable in restricted contexts.
        }
      }

      shouldKeepRouting = true;
      const nextPath = getCurrentRedirectPath();
      setPendingPostLoginPath(nextPath);
    } catch {
      setLoginError("Não foi possível entrar agora. Tente novamente em instantes.");
    } finally {
      if (!shouldKeepRouting) {
        setIsSubmittingLogin(false);
      }
    }
  }

  async function handleResendEmailConfirmation() {
    const normalizedEmail = email.trim().toLowerCase();
    setConfirmationResendMessage(null);
    setConfirmationResendError(null);

    if (!normalizedEmail) {
      setConfirmationResendError("Informe o e-mail do cadastro para receber um novo link.");
      return;
    }

    setIsResendingConfirmation(true);
    try {
      const result = await authAPI.resendSignupEmailConfirmation(normalizedEmail);

      if (result.status < 200 || result.status >= 300 || !result.ok) {
        setConfirmationResendError(result.message);
        return;
      }

      setConfirmationResendMessage(result.message);
    } catch {
      setConfirmationResendError("Não foi possível solicitar outro e-mail agora.");
    } finally {
      setIsResendingConfirmation(false);
    }
  }

  async function handleRecoverySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    setRecoveryError(null);
    setRecoveryMessage(null);

    if (!email) {
      setRecoveryError("Informe seu e-mail para receber o link.");
      return;
    }

    setIsSubmittingRecovery(true);

    try {
      const { error } = await resetPassword(email);

      if (error) {
        setRecoveryError("Não foi possível enviar o link. Confira o e-mail e tente novamente.");
        return;
      }

      setRecoveryMessage("Enviamos um link de recuperação para o seu e-mail.");
    } catch {
      setRecoveryError("Não foi possível enviar o link agora. Tente novamente em instantes.");
    } finally {
      setIsSubmittingRecovery(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      {!isRecoveringPassword ? (
        <header className="mb-8 text-left lg:mb-10">
          <h1 className={`text-[20px] font-normal ${textClass}`}>
            Entrar no Vimob crm
          </h1>
          <p className={`mt-1.5 text-[12px] font-light ${mutedTextClass}`}>
            Acesse seu sistema de gestão imobiliária
          </p>
        </header>
      ) : null}

      {isRecoveringPassword ? (
        <form
          method="post"
          autoComplete="on"
          onSubmit={handleRecoverySubmit}
          className="space-y-6"
          aria-busy={isSubmittingRecovery}
        >
          <button
            type="button"
            onClick={showLoginForm}
            className={`flex cursor-pointer items-center gap-3 text-sm font-light outline-none transition-colors hover:text-primary focus-visible:text-primary ${textClass}`}
            aria-label="Voltar para o login"
          >
            <ArrowLeftIcon />
            Recuperar senha
          </button>

          <p className={`text-[12px] font-light leading-[18px] ${paragraphTextClass}`}>
            Digite seu e-mail e enviaremos um link para redefinir sua senha.
          </p>

          <div className="space-y-2">
            <label
              htmlFor="recovery-email"
              className={labelClass}
            >
              Seu e-mail
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <EnvelopeIcon className={iconClass} />
              </span>
              <input
                id="recovery-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                required
                placeholder="seu@email.com"
                aria-invalid={Boolean(recoveryError)}
                aria-describedby={recoveryError ? "recovery-error" : undefined}
                className={`${inputClass} pl-11`}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmittingRecovery}
            className="auth-primary-action h-12 w-full cursor-pointer rounded-[6px] text-[12px] font-light shadow-none outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isSubmittingRecovery ? "Enviando..." : "Enviar link de recuperação"}
          </button>

          {recoveryError ? (
            <p
              id="recovery-error"
              className="text-center text-sm font-light leading-5 text-primary"
              role="alert"
            >
              {recoveryError}
            </p>
          ) : null}

          {recoveryMessage ? (
            <p className={`text-center text-sm font-light leading-5 ${successTextClass}`} aria-live="polite">
              {recoveryMessage}
            </p>
          ) : null}
        </form>
      ) : (
        <>
          <form
            method="post"
            autoComplete="on"
            onSubmit={handleSubmit}
            className="space-y-4"
            aria-busy={isSubmittingLogin}
          >
            <div className="space-y-2">
              <label
                htmlFor="email"
                className={labelClass}
              >
                Seu e-mail
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <EnvelopeIcon className={iconClass} />
                </span>
                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  required
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setConfirmationResendMessage(null);
                    setConfirmationResendError(null);
                  }}
                  aria-invalid={Boolean(loginError)}
                  aria-describedby={loginError ? "login-error" : undefined}
                  className={`${inputClass} pl-11`}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className={labelClass}
              >
                Sua senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  aria-invalid={Boolean(loginError)}
                  aria-describedby={loginError ? "login-error" : undefined}
                  className={`${inputClass} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className={`absolute inset-y-0 right-0 flex cursor-pointer items-center px-4 outline-none transition-colors ${iconButtonClass}`}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>

            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <span className="relative flex h-4 w-4 items-center justify-center">
                <input
                  id="remember-email"
                  name="remember-email"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="peer sr-only"
                />
                <span className={`h-4 w-4 rounded-[4px] border transition-colors ${checkboxBorderClass}`} />
                <span className="pointer-events-none absolute hidden h-2 w-2 rounded-[2px] bg-primary peer-checked:block" />
              </span>
              <span className={`text-[13px] font-light ${textClass}`}>
                Lembrar e-mail
              </span>
            </label>

            <button
              type="submit"
              disabled={isSubmittingLogin}
              className="auth-primary-action h-12 w-full cursor-pointer rounded-[6px] text-[12px] font-light shadow-none outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isSubmittingLogin ? "Entrando..." : "Entrar"}
            </button>

            {loginError ? (
              <p
                id="login-error"
                className="text-center text-sm font-light leading-5 text-primary"
                role="alert"
              >
                {loginError}
              </p>
            ) : null}

            {emailConfirmationPending ? (
              <div className="space-y-2 text-center">
                <button
                  type="button"
                  onClick={() => void handleResendEmailConfirmation()}
                  disabled={isResendingConfirmation || !email.trim()}
                  className="cursor-pointer text-[12px] font-light text-primary outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isResendingConfirmation ? "Enviando novo link..." : "Reenviar e-mail de confirmação"}
                </button>
                {confirmationResendMessage ? (
                  <p className={`text-[12px] font-light leading-5 ${successTextClass}`} aria-live="polite">
                    {confirmationResendMessage}
                  </p>
                ) : null}
                {confirmationResendError ? (
                  <p className="text-[12px] font-light leading-5 text-primary" role="alert">
                    {confirmationResendError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!loginError && recoveryMessage ? (
              <p className={`text-center text-sm font-light leading-5 ${successTextClass}`} aria-live="polite">
                {recoveryMessage}
              </p>
            ) : null}
          </form>

          <footer className="mt-5 flex items-center justify-center gap-3 text-[13px] font-light">
            <button
              type="button"
              onClick={showRecoveryForm}
              className="-my-2 inline-flex min-h-11 cursor-pointer items-center py-2 text-primary outline-none transition-opacity hover:opacity-80"
            >
              Esqueceu sua senha?
            </button>
            <span className={separatorClass} aria-hidden="true">
              ·
            </span>
            <Link
              href="/cadastro"
              className="-my-2 inline-flex min-h-11 cursor-pointer items-center py-2 text-primary outline-none transition-opacity hover:opacity-80"
            >
              Cadastre-se
            </Link>
          </footer>

        </>
      )}
    </div>
  );
}
