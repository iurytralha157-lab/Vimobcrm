"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

type FormMode = "login" | "recover";
type AuthTheme = "dark" | "light";

const defaultPostLoginPath = "/dashboard";
const blockedPostLoginPrefixes = [
  "/login",
  "/cadastro",
  "/reset-password",
  "/onboarding",
  "/select-organization",
];
const sensitiveLoginParams = ["email", "password", "senha", "pass", "pwd"];

function getSafeRedirectPath(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return defaultPostLoginPath;
  }

  if (blockedPostLoginPrefixes.some((prefix) => value.startsWith(prefix))) {
    return defaultPostLoginPath;
  }

  return value;
}

function getCurrentRedirectPath() {
  if (typeof window === "undefined") {
    return defaultPostLoginPath;
  }

  const params = new URLSearchParams(window.location.search);
  return getSafeRedirectPath(params.get("redirectTo"));
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
  const safeRedirectTo = getSafeRedirectPath(redirectTo);
  const params = new URLSearchParams({ redirectTo: safeRedirectTo });
  return `/select-organization?${params.toString()}`;
}

function VimobLogo({ theme }: { theme: AuthTheme }) {
  return (
    <Image
      src={theme === "light" ? "/images/logo-black.png" : "/images/logo-white.png"}
      alt="Vimob"
      width={1228}
      height={429}
      priority
      className="mx-auto"
      style={{ width: "148px", height: "auto" }}
    />
  );
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

export function LoginForm({ theme = "dark" }: { theme?: AuthTheme }) {
  const router = useRouter();
  const {
    signIn,
    resetPassword,
    loading,
    authInitialized,
    organizationsLoaded,
    isInitializingOrg,
    isSuperAdmin,
    userOrganizations,
  } = useAuth();
  const [formMode, setFormMode] = useState<FormMode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false);
  const [pendingPostLoginPath, setPendingPostLoginPath] = useState<string | null>(null);

  const isRecoveringPassword = formMode === "recover";
  const isLightTheme = theme === "light";
  const textClass = isLightTheme ? "text-[#151515]" : "text-white";
  const mutedTextClass = isLightTheme ? "text-[#626872]" : "text-white/50";
  const paragraphTextClass = isLightTheme ? "text-[#4f5660]" : "text-white/72";
  const subtleTextClass = isLightTheme ? "text-[#626872]" : "text-white/70";
  const separatorClass = isLightTheme ? "text-[#a4aab2]" : "text-white/30";
  const iconClass = isLightTheme ? "text-[#626872]/75" : "text-white/40";
  const iconButtonClass = isLightTheme
    ? "text-[#626872] hover:text-[#151515] focus-visible:text-[#151515]"
    : "text-white/65 hover:text-white/90 focus-visible:text-white";
  const labelClass = `block text-sm font-extralight tracking-wide ${textClass}`;
  const inputClass = `h-12 w-full rounded-[6px] border px-4 text-sm font-extralight tracking-wide outline-none transition-colors ${
    isLightTheme
      ? "border-[#e5e7eb] bg-white text-[#151515] placeholder:text-[#626872]/45 focus:border-[#FF4529]/60 focus:bg-white"
      : "border-transparent bg-[#121212] text-white placeholder:text-white/30 focus:border-transparent focus:bg-[#121212]"
  }`;
  const checkboxBorderClass = isLightTheme
    ? "border-[#cfd4dc] peer-checked:border-[#FF4529] peer-focus-visible:border-[#FF4529]"
    : "border-white/10 peer-checked:border-[#FF4529] peer-focus-visible:border-[#FF4529]";

  useEffect(() => {
    sanitizeLoginUrl();
  }, []);

  useEffect(() => {
    if (!pendingPostLoginPath) return;
    if (loading || !authInitialized || !organizationsLoaded || isInitializingOrg) return;

    const activeOrganizations = userOrganizations.filter((org) => org.is_active);

    if (isSuperAdmin) {
      router.replace(pendingPostLoginPath.startsWith("/admin") ? pendingPostLoginPath : "/admin");
      return;
    }

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
    organizationsLoaded,
    pendingPostLoginPath,
    router,
    userOrganizations,
  ]);

  function showRecoveryForm() {
    setLoginError(null);
    setRecoveryError(null);
    setRecoveryMessage(null);
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
      const { error, isSuperAdmin: signedInIsSuperAdmin } = await signIn(email, password);

      if (error) {
        setLoginError("E-mail ou senha invalidos. Confira os dados e tente novamente.");
        return;
      }

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
      if (signedInIsSuperAdmin) {
        router.replace(nextPath.startsWith("/admin") ? nextPath : "/admin");
        return;
      }
      setPendingPostLoginPath(nextPath);
    } catch {
      setLoginError("Não foi possível entrar agora. Tente novamente em instantes.");
    } finally {
      if (!shouldKeepRouting) {
        setIsSubmittingLogin(false);
      }
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

      setRecoveryMessage("Enviamos um link de recuperacao para o seu e-mail.");
    } catch {
      setRecoveryError("Não foi possível enviar o link agora. Tente novamente em instantes.");
    } finally {
      setIsSubmittingRecovery(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <header className="mb-4 text-center">
        <VimobLogo theme={theme} />
        <p className={`mt-4 text-sm font-extralight tracking-wide ${mutedTextClass}`}>
          {isRecoveringPassword
            ? "Recupere o acesso à sua conta"
            : "Acesse seu sistema de gestão imobiliária"}
        </p>
      </header>

      {isRecoveringPassword ? (
        <form method="post" onSubmit={handleRecoverySubmit} className="space-y-6">
          <button
            type="button"
            onClick={showLoginForm}
            className={`flex cursor-pointer items-center gap-3 text-sm font-semibold outline-none transition-colors hover:text-[#FF4529] focus-visible:text-[#FF4529] ${textClass}`}
            aria-label="Voltar para o login"
          >
            <ArrowLeftIcon />
            Recuperar senha
          </button>

          <p className={`text-sm font-extralight leading-6 tracking-wide ${paragraphTextClass}`}>
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
                autoComplete="email"
                required
                placeholder="seu@email.com"
                className={`${inputClass} pl-11`}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmittingRecovery}
            className="h-12 w-full cursor-pointer rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isSubmittingRecovery ? "Enviando..." : "Enviar link de recuperação"}
          </button>

          {recoveryError ? (
            <p className="text-center text-sm font-extralight leading-5 text-[#FF4529]" aria-live="polite">
              {recoveryError}
            </p>
          ) : null}

          {recoveryMessage ? (
            <p className={`text-center text-sm font-extralight leading-5 ${subtleTextClass}`} aria-live="polite">
              {recoveryMessage}
            </p>
          ) : null}
        </form>
      ) : (
        <>
          <form method="post" onSubmit={handleSubmit} className="space-y-4">
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
                  autoComplete="email"
                  required
                  placeholder="seu@email.com"
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

            <label className="flex cursor-pointer items-center gap-3">
              <span className="relative flex h-4 w-4 items-center justify-center">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="peer sr-only"
                />
                <span className={`h-4 w-4 rounded-full border transition-colors ${checkboxBorderClass}`} />
                <span className="pointer-events-none absolute hidden h-2 w-2 rounded-full bg-[#FF4529] peer-checked:block" />
              </span>
              <span className={`text-sm font-extralight tracking-wide ${textClass}`}>
                Lembrar-me
              </span>
            </label>

            <button
              type="submit"
              disabled={isSubmittingLogin}
              className="h-12 w-full cursor-pointer rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isSubmittingLogin ? "Entrando..." : "Entrar"}
            </button>

            {loginError ? (
              <p className="text-center text-sm font-extralight leading-5 text-[#FF4529]" aria-live="polite">
                {loginError}
              </p>
            ) : null}
          </form>

          <footer className="mt-5 flex items-center justify-center gap-3 text-sm font-extralight tracking-wide">
            <button
              type="button"
              onClick={showRecoveryForm}
              className="cursor-pointer text-[#FF4529] outline-none transition-opacity hover:opacity-80"
            >
              Esqueceu sua senha?
            </button>
            <span className={separatorClass} aria-hidden="true">
              ·
            </span>
            <Link
              href="/cadastro"
              className="cursor-pointer text-[#FF4529] outline-none transition-opacity hover:opacity-80"
            >
              Cadastre-se
            </Link>
          </footer>

          <p className={`mx-auto mt-3 max-w-[320px] text-center text-xs font-extralight leading-5 tracking-wide ${mutedTextClass}`}>
            Ao continuar, você concorda com os{" "}
            <Link
              href="/termos-de-uso"
              className="text-[#FF4529] outline-none transition-opacity hover:opacity-80"
            >
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link
              href="/politica-de-privacidade"
              className="text-[#FF4529] outline-none transition-opacity hover:opacity-80"
            >
                Política de Privacidade
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
