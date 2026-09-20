"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { adminAPI } from "@/lib/api/admin";
import { authAPI } from "@/lib/api/auth";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { supabase } from "@/lib/supabase/client";
import { useInvitationByToken } from "@/hooks/use-invitation-by-token";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/config/constants";
import {
  createInvitationPath,
  isConfirmedInvitationAcceptance,
} from "@/lib/auth/invitation";
import { createLoginPath } from "@/lib/auth/post-login-redirect";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/validation/onboarding";
import {
  evaluatePasswordPolicy,
  PASSWORD_POLICY,
  strongPasswordSchema,
} from "@/lib/validation/password";

type AcceptResult = {
  success: boolean;
  requiresLogin: boolean;
  existingAccount?: boolean;
  email: string;
  organizationId: string;
  organizationName: string;
  message?: string;
};

type ConfirmedInvitation = {
  organizationName: string;
  message: string;
  nextStep: "login" | "organizations";
};

const selectOrganizationPath = `/select-organization?redirectTo=${encodeURIComponent(DEFAULT_AUTHENTICATED_ROUTE)}`;
const postAcceptanceLoginPath = createLoginPath(DEFAULT_AUTHENTICATED_ROUTE, DEFAULT_AUTHENTICATED_ROUTE);

function isValidInvitationWhatsApp(value: string) {
  const normalized = value.trim();
  if (!normalized) return true;
  const digits = normalized.replace(/\D/g, "");
  return normalized.length <= 40
    && /^[\d+\s().-]+$/.test(normalized)
    && digits.length >= 10
    && digits.length <= 15;
}

const invitationActionClass =
  "auth-primary-action inline-flex h-11 items-center justify-center rounded-[6px] px-5 text-[12px] font-light shadow-none outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-55";
const invitationFieldClass =
  "auth-login-field h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-4 text-base text-[var(--app-text-primary)] shadow-none outline-none ring-0 transition-colors placeholder:text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-solid)] focus:ring-1 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm";
const invitationStateTitleClass = "text-[14px] font-normal text-[var(--app-text-primary)]";
const invitationStateTextClass = "text-[12px] font-light leading-5 text-[var(--app-text-secondary)]";

type InvitationField =
  | "name"
  | "whatsapp"
  | "password"
  | "passwordConfirm"
  | "terms"
  | "privacy";

const invitationFieldIds: Record<InvitationField, string> = {
  name: "invitation-name",
  whatsapp: "invitation-whatsapp",
  password: "invitation-password",
  passwordConfirm: "invitation-password-confirm",
  terms: "invitation-terms",
  privacy: "invitation-privacy",
};

type InvitationConsentCheckboxProps = Readonly<{
  id: string;
  name: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  prefix: string;
  href: string;
  linkLabel: string;
  version: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}>;

function InvitationConsentCheckbox({
  id,
  name,
  checked,
  onCheckedChange,
  prefix,
  href,
  linkLabel,
  version,
  disabled = false,
  invalid = false,
  describedBy,
}: InvitationConsentCheckboxProps) {
  return (
    <div className="flex items-start gap-3 text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        aria-label={`${prefix} ${linkLabel}, versão ${version}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border border-[var(--app-border-strong)] bg-[var(--app-surface-solid)] accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p className="min-w-0">
        <label htmlFor={id} className="cursor-pointer">
          {prefix}{" "}
        </label>
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          className="text-primary underline-offset-4 outline-none transition-opacity hover:opacity-80 focus-visible:underline"
        >
          {linkLabel}
        </Link>{" "}
        <span className="font-mono text-[11px] text-[var(--app-text-tertiary)]">({version})</span>.
      </p>
    </div>
  );
}

export function InvitationScreen({ token }: { token: string | null; }) {
  const router = useRouter();
  const { refreshOrganizations } = useAuth();
  const {
    canonicalToken,
    data: invitation,
    invitationState,
    isFetching: isRetryingLookup,
    retryLookup,
  } = useInvitationByToken(token);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvitationField | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [confirmedInvitation, setConfirmedInvitation] = useState<ConfirmedInvitation | null>(null);
  const submissionInFlightRef = useRef(false);

  const email = invitation?.email || "";
  const organizationName = invitation?.organization_name || "sua imobiliária";
  const roleLabel = useMemo(() => {
    if (invitation?.role === "admin") return "Administrador";
    if (invitation?.role === "manager") return "Gestor";
    return "Usuário";
  }, [invitation?.role]);
  const existingAccount = Boolean(invitation?.existing_account || requiresLogin);
  const passwordRequirements = useMemo(
    () => evaluatePasswordPolicy(password),
    [password],
  );
  const loggedEmailMatches = Boolean(
    currentUserEmail && email && currentUserEmail.toLowerCase() === email.toLowerCase(),
  );
  const invitationPath = createInvitationPath(canonicalToken);
  const loginForInvitationPath = createLoginPath(invitationPath, DEFAULT_AUTHENTICATED_ROUTE);

  function clearFieldError(field: InvitationField) {
    if (invalidField !== field) return;
    setInvalidField(null);
    setErrorMessage(null);
  }

  function reportFieldError(field: InvitationField, message: string) {
    setInvalidField(field);
    setErrorMessage(message);
    window.requestAnimationFrame(() => {
      document.getElementById(invitationFieldIds[field])?.focus();
    });
  }

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getUser()
      .then(({ data }) => {
        if (!mounted) return;
        setCurrentUserEmail(data.user?.email ?? null);
        setCheckingSession(false);
      })
      .catch(() => {
        if (!mounted) return;
        setCurrentUserEmail(null);
        setCheckingSession(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserEmail(session?.user?.email ?? null);
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleAcceptNewAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setInvalidField(null);
    setStatusMessage(null);

    if (!canonicalToken || !invitation || !email) {
      setErrorMessage("Convite inválido ou expirado.");
      return;
    }
    const trimmedName = name.trim();
    if (Array.from(trimmedName).length < 2 || Array.from(trimmedName).length > 140) {
      reportFieldError("name", "Informe seu nome para continuar.");
      return;
    }
    if (!isValidInvitationWhatsApp(whatsapp)) {
      reportFieldError("whatsapp", "Informe um WhatsApp válido ou deixe o campo vazio.");
      return;
    }
    const passwordValidation = strongPasswordSchema.safeParse(password);
    if (!passwordValidation.success) {
      reportFieldError(
        "password",
        passwordValidation.error.issues[0]?.message
          || "Crie uma senha que atenda a todos os requisitos.",
      );
      return;
    }
    if (password !== passwordConfirm) {
      reportFieldError("passwordConfirm", "As senhas não conferem.");
      return;
    }
    if (!termsAccepted) {
      reportFieldError("terms", "Aceite os termos e a política de privacidade para continuar.");
      return;
    }
    if (!privacyAccepted) {
      reportFieldError("privacy", "Aceite os termos e a política de privacidade para continuar.");
      return;
    }

    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;

    setIsSubmitting(true);
    let result: AcceptResult;
    try {
      result = await adminAPI.acceptInvitationPublic<AcceptResult>(canonicalToken, {
        name: trimmedName,
        password,
        whatsapp: whatsapp.trim() || null,
        termsAccepted,
        privacyAccepted,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível aceitar o convite agora.");
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      return;
    }

    if (result.requiresLogin) {
      setRequiresLogin(true);
      setStatusMessage(result.message || "Entre com sua conta para aceitar este convite.");
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      return;
    }
    if (!isConfirmedInvitationAcceptance(result)) {
      setErrorMessage(result.message || "Não foi possível confirmar o aceite do convite.");
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      return;
    }

    // The backend has consumed the token. Authentication is now a separate,
    // best-effort step and cannot turn a confirmed acceptance into an error.
    setConfirmedInvitation({
      organizationName: result.organizationName || organizationName,
      message: result.message || "Convite aceito com sucesso.",
      nextStep: "login",
    });
    try {
      const { error } = await authAPI.login(email, password);
      if (error) {
        setConfirmedInvitation((current) => current ? {
          ...current,
          message: "Convite aceito. Entre com sua nova senha para acessar.",
        } : current);
        submissionInFlightRef.current = false;
        setIsSubmitting(false);
        return;
      }
      setConfirmedInvitation((current) => current ? { ...current, nextStep: "organizations" } : current);
      router.replace(selectOrganizationPath);
    } catch {
      setConfirmedInvitation((current) => current ? {
        ...current,
        message: "Convite aceito. Entre com sua nova senha para acessar.",
      } : current);
    }
    submissionInFlightRef.current = false;
    setIsSubmitting(false);
  }

  async function handleAcceptExistingAccount() {
    setErrorMessage(null);
    setInvalidField(null);
    setStatusMessage(null);
    if (!termsAccepted) {
      reportFieldError("terms", "Aceite os termos e a política de privacidade para continuar.");
      return;
    }
    if (!privacyAccepted) {
      reportFieldError("privacy", "Aceite os termos e a política de privacidade para continuar.");
      return;
    }
    if (!canonicalToken) {
      setErrorMessage("Link de convite inválido.");
      return;
    }
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    let result: AcceptResult;
    try {
      result = await adminAPI.acceptInvitationAuthenticated<AcceptResult>(canonicalToken, {
        termsAccepted,
        privacyAccepted,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      });
    } catch (error) {
      if (error instanceof VimobAPIError && error.status === 401) {
        router.replace(loginForInvitationPath);
        submissionInFlightRef.current = false;
        setIsSubmitting(false);
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível aceitar o convite agora.");
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      return;
    }
    if (!isConfirmedInvitationAcceptance(result)) {
      setErrorMessage(result.message || "Não foi possível confirmar o aceite do convite.");
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      return;
    }

    setConfirmedInvitation({
      organizationName: result.organizationName || organizationName,
      message: result.message || "Convite aceito com sucesso.",
      nextStep: "organizations",
    });
    try {
      await refreshOrganizations();
      router.replace(selectOrganizationPath);
    } catch {
      setConfirmedInvitation((current) => current ? {
        ...current,
        message: "Convite aceito. Continue para selecionar sua organização.",
      } : current);
    }
    submissionInFlightRef.current = false;
    setIsSubmitting(false);
  }

  async function handleLoginForInvitation() {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      router.replace(loginForInvitationPath);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <header className="mb-8 text-left lg:mb-10">
        <h1 className="text-[20px] font-normal text-[var(--app-text-primary)]">
          Aceitar convite
        </h1>
        <p className="mt-1.5 text-[12px] font-light text-[var(--app-text-tertiary)]">
          Complete seu acesso ao Vimob CRM
        </p>
      </header>

      {confirmedInvitation ? (
        <div className="space-y-5 text-center" role="status" aria-live="polite">
          <div className="rounded-[6px] border border-primary/25 bg-primary/10 p-4">
            <h2 className={invitationStateTitleClass}>Convite aceito</h2>
            <p className={cn(invitationStateTextClass, "mt-2")}>
              {confirmedInvitation.message}
            </p>
            <p className="mt-2 text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
              Seu acesso a {confirmedInvitation.organizationName} já foi confirmado.
            </p>
          </div>
          <Link
            href={confirmedInvitation.nextStep === "login" ? postAcceptanceLoginPath : selectOrganizationPath}
            className={cn(invitationActionClass, "h-12 w-full")}
          >
            {confirmedInvitation.nextStep === "login" ? "Entrar" : "Continuar"}
          </Link>
        </div>
      ) : invitationState === "loading" ? (
        <div
          className="flex min-h-[260px] items-center justify-center"
          role="status"
          aria-label="Carregando convite"
        >
          <Loader2 className="h-5 w-5 animate-spin text-[var(--app-text-tertiary)]" />
        </div>
      ) : invitationState === "unavailable" ? (
        <div className="space-y-5 text-center">
          <div className="rounded-[6px] border border-primary/25 bg-primary/10 p-4">
            <h2 className={invitationStateTitleClass}>Consulta indisponível</h2>
            <p className={cn(invitationStateTextClass, "mt-2")}>
              Não foi possível consultar este convite agora. Seu link não foi invalidado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void retryLookup()}
            disabled={isRetryingLookup}
            className={cn(invitationActionClass, "h-12 w-full")}
          >
            {isRetryingLookup ? "Tentando novamente..." : "Tentar novamente"}
          </button>
        </div>
      ) : invitationState === "invalid" ? (
        <div className="space-y-5 text-center">
          <div className="rounded-[6px] border border-primary/25 bg-primary/10 p-4">
            <h2 className={invitationStateTitleClass}>Link de convite inválido</h2>
            <p className={cn(invitationStateTextClass, "mt-2")}>
              Confira se o link foi copiado por completo ou solicite um novo convite.
            </p>
          </div>
          <Link href="/login" className={cn(invitationActionClass, "h-12 w-full")}>
            Ir para login
          </Link>
        </div>
      ) : invitationState === "expired" ? (
        <div className="space-y-5 text-center">
          <div className="rounded-[6px] border border-primary/25 bg-primary/10 p-4">
            <h2 className={invitationStateTitleClass}>Convite expirado ou já utilizado</h2>
            <p className={cn(invitationStateTextClass, "mt-2")}>
              Solicite um novo convite ao administrador da organização.
            </p>
          </div>
          <Link href="/login" className={cn(invitationActionClass, "h-12 w-full")}>
            Ir para login
          </Link>
        </div>
      ) : invitation ? (
        <form
          noValidate
          onSubmit={handleAcceptNewAccount}
          className="space-y-4"
          aria-busy={isSubmitting}
        >
          <div className="rounded-[6px] border border-primary/25 bg-primary/10 p-4 text-[13px] font-light text-[var(--app-text-secondary)]">
            <p className="font-normal text-[var(--app-text-primary)]">Convite para {organizationName}</p>
            <p className="mt-1 break-words text-[var(--app-text-tertiary)]">{email}</p>
            <p className="mt-1 text-[var(--app-text-tertiary)]">Função: {roleLabel}</p>
          </div>

          {existingAccount ? (
            <div className="space-y-3">
              <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
                {checkingSession ? (
                  "Verificando sua sessão..."
                ) : loggedEmailMatches ? (
                  "Você já está conectado com este e-mail. Confirme para entrar nesta organização."
                ) : currentUserEmail ? (
                  <>
                    Você está conectado como <span className="text-[var(--app-text-primary)]">{currentUserEmail}</span>. Saia e entre com{" "}
                    <span className="text-[var(--app-text-primary)]">{email}</span> para aceitar o convite.
                  </>
                ) : (
                  "Este e-mail já possui uma conta Vimob. Entre com seu acesso atual para aceitar o convite."
                )}
              </div>
              {loggedEmailMatches ? (
                <div className="space-y-2 pt-1">
                  <InvitationConsentCheckbox
                    id="invitation-terms"
                    name="existingTermsAccepted"
                    checked={termsAccepted}
                    disabled={isSubmitting}
                    invalid={invalidField === "terms"}
                    describedBy={invalidField === "terms" ? "invitation-form-message" : undefined}
                    onCheckedChange={(checked) => {
                      setTermsAccepted(checked);
                      clearFieldError("terms");
                    }}
                    prefix="Li e aceito os"
                    href="/termos-de-uso"
                    linkLabel="Termos de Uso"
                    version={CURRENT_TERMS_VERSION}
                  />
                  <InvitationConsentCheckbox
                    id="invitation-privacy"
                    name="existingPrivacyAccepted"
                    checked={privacyAccepted}
                    disabled={isSubmitting}
                    invalid={invalidField === "privacy"}
                    describedBy={invalidField === "privacy" ? "invitation-form-message" : undefined}
                    onCheckedChange={(checked) => {
                      setPrivacyAccepted(checked);
                      clearFieldError("privacy");
                    }}
                    prefix="Li e aceito a"
                    href="/politica-de-privacidade"
                    linkLabel="Política de Privacidade"
                    version={CURRENT_PRIVACY_VERSION}
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={loggedEmailMatches ? handleAcceptExistingAccount : handleLoginForInvitation}
                disabled={
                  isSubmitting
                  || checkingSession
                  || (loggedEmailMatches && (!termsAccepted || !privacyAccepted))
                }
                className={cn(invitationActionClass, "h-12 w-full")}
              >
                {isSubmitting ? "Verificando..." : loggedEmailMatches ? "Aceitar convite" : "Entrar para aceitar"}
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label htmlFor="invitation-name" className="block text-[13px] font-light text-[var(--app-text-primary)]">
                  Nome completo
                </label>
                <input
                  id="invitation-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  minLength={2}
                  maxLength={140}
                  required
                  disabled={isSubmitting}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearFieldError("name");
                  }}
                  aria-invalid={invalidField === "name" || undefined}
                  aria-describedby={invalidField === "name" ? "invitation-form-message" : undefined}
                  className={invitationFieldClass}
                  placeholder="Seu nome"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="invitation-whatsapp" className="block text-[13px] font-light text-[var(--app-text-primary)]">
                  WhatsApp <span className="text-[var(--app-text-tertiary)]">(opcional)</span>
                </label>
                <input
                  id="invitation-whatsapp"
                  name="whatsapp"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={40}
                  disabled={isSubmitting}
                  value={whatsapp}
                  onChange={(event) => {
                    setWhatsapp(event.target.value);
                    clearFieldError("whatsapp");
                  }}
                  aria-invalid={invalidField === "whatsapp" || undefined}
                  aria-describedby={invalidField === "whatsapp" ? "invitation-form-message" : undefined}
                  className={invitationFieldClass}
                  placeholder="+55 (00) 00000-0000"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="invitation-password" className="block text-[13px] font-light text-[var(--app-text-primary)]">
                    Senha
                  </label>
                  <div className="relative">
                    <input
                      id="invitation-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={PASSWORD_POLICY.minLength}
                      maxLength={PASSWORD_POLICY.maxLength}
                      required
                      disabled={isSubmitting}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        clearFieldError("password");
                      }}
                      aria-invalid={invalidField === "password" || undefined}
                      aria-describedby={[
                        "invitation-password-requirements",
                        invalidField === "password" ? "invitation-form-message" : null,
                      ].filter(Boolean).join(" ")}
                      className={cn(invitationFieldClass, "pr-12")}
                      placeholder="Mín. 8 caracteres"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={isSubmitting}
                      className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-4 text-[var(--app-text-tertiary)] outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="invitation-password-confirm" className="block text-[13px] font-light text-[var(--app-text-primary)]">
                    Confirmar
                  </label>
                  <div className="relative">
                    <input
                      id="invitation-password-confirm"
                      name="passwordConfirm"
                      type={showPasswordConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={PASSWORD_POLICY.minLength}
                      maxLength={PASSWORD_POLICY.maxLength}
                      required
                      disabled={isSubmitting}
                      value={passwordConfirm}
                      onChange={(event) => {
                        setPasswordConfirm(event.target.value);
                        clearFieldError("passwordConfirm");
                      }}
                      aria-invalid={invalidField === "passwordConfirm" || undefined}
                      aria-describedby={invalidField === "passwordConfirm" ? "invitation-form-message" : undefined}
                      className={cn(invitationFieldClass, "pr-12")}
                      placeholder="Repita a senha"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordConfirm((current) => !current)}
                      disabled={isSubmitting}
                      className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-4 text-[var(--app-text-tertiary)] outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={showPasswordConfirm ? "Ocultar confirmação de senha" : "Mostrar confirmação de senha"}
                    >
                      {showPasswordConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div
                id="invitation-password-requirements"
                className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-light"
              >
                {passwordRequirements.map((requirement) => (
                  <span
                    key={requirement.id}
                    className={requirement.isValid ? "text-primary" : "text-[var(--app-text-tertiary)]"}
                  >
                    {requirement.label}
                    <span className="sr-only">
                      {requirement.isValid ? ": requisito atendido" : ": requisito pendente"}
                    </span>
                  </span>
                ))}
              </div>

              <div className="space-y-2 pt-1">
                <InvitationConsentCheckbox
                  id="invitation-terms"
                  name="termsAccepted"
                  checked={termsAccepted}
                  disabled={isSubmitting}
                  invalid={invalidField === "terms"}
                  describedBy={invalidField === "terms" ? "invitation-form-message" : undefined}
                  onCheckedChange={(checked) => {
                    setTermsAccepted(checked);
                    clearFieldError("terms");
                  }}
                  prefix="Li e aceito os"
                  href="/termos-de-uso"
                  linkLabel="Termos de Uso"
                  version={CURRENT_TERMS_VERSION}
                />
                <InvitationConsentCheckbox
                  id="invitation-privacy"
                  name="privacyAccepted"
                  checked={privacyAccepted}
                  disabled={isSubmitting}
                  invalid={invalidField === "privacy"}
                  describedBy={invalidField === "privacy" ? "invitation-form-message" : undefined}
                  onCheckedChange={(checked) => {
                    setPrivacyAccepted(checked);
                    clearFieldError("privacy");
                  }}
                  prefix="Li e aceito a"
                  href="/politica-de-privacidade"
                  linkLabel="Política de Privacidade"
                  version={CURRENT_PRIVACY_VERSION}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !termsAccepted || !privacyAccepted}
                className={cn(invitationActionClass, "h-12 w-full")}
              >
                {isSubmitting ? "Finalizando..." : "Aceitar convite"}
              </button>
            </>
          )}

          <p
            id="invitation-form-message"
            className={cn(
              "min-h-5 text-center text-[12px] font-light leading-5",
              errorMessage ? "text-primary" : "text-[var(--app-text-tertiary)]",
            )}
            role={errorMessage ? "alert" : "status"}
          >
            {errorMessage || statusMessage}
          </p>
        </form>
      ) : null}
    </div>
  );
}
