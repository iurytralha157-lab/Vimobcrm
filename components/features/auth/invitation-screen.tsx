"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { adminAPI } from "@/lib/api/admin";
import { authAPI } from "@/lib/api/auth";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { supabase } from "@/integrations/supabase/client";
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
import { AuthLogo } from "./auth-logo";

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
  "h-12 w-full rounded-[6px] border-0 bg-[var(--auth-hero-panel)] px-4 text-[13px] font-light text-white shadow-none outline-none transition-colors placeholder:text-white/40 focus:bg-[var(--auth-hero-panel-hover)] focus:ring-1 focus:ring-primary/40";
const invitationStateTitleClass = "text-[14px] font-normal text-white";
const invitationStateTextClass = "text-[12px] font-light leading-5 text-white/65";

type InvitationConsentCheckboxProps = Readonly<{
  id: string;
  name: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  prefix: string;
  href: string;
  linkLabel: string;
  version: string;
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
}: InvitationConsentCheckboxProps) {
  return (
    <div className="flex items-start gap-3 text-[12px] font-light leading-5 text-white/70">
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        aria-label={`${prefix} ${linkLabel}, versão ${version}`}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border border-white/15 bg-[var(--auth-hero-panel)] accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
          className="text-primary outline-none transition-opacity hover:opacity-80 focus-visible:opacity-80"
        >
          {linkLabel}
        </Link>{" "}
        <span className="font-mono text-[11px] text-white/50">({version})</span>.
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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [confirmedInvitation, setConfirmedInvitation] = useState<ConfirmedInvitation | null>(null);

  const email = invitation?.email || "";
  const organizationName = invitation?.organization_name || "sua imobiliaria";
  const roleLabel = useMemo(() => {
    if (invitation?.role === "admin") return "Administrador";
    if (invitation?.role === "manager") return "Gestor";
    return "Usuario";
  }, [invitation?.role]);
  const existingAccount = Boolean(invitation?.existing_account || requiresLogin);
  const loggedEmailMatches = Boolean(
    currentUserEmail && email && currentUserEmail.toLowerCase() === email.toLowerCase(),
  );
  const invitationPath = createInvitationPath(canonicalToken);
  const loginForInvitationPath = createLoginPath(invitationPath, DEFAULT_AUTHENTICATED_ROUTE);

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
    setStatusMessage(null);

    if (!canonicalToken || !invitation || !email) {
      setErrorMessage("Convite invalido ou expirado.");
      return;
    }
    const trimmedName = name.trim();
    if (Array.from(trimmedName).length < 2 || Array.from(trimmedName).length > 140) {
      setErrorMessage("Informe seu nome para continuar.");
      return;
    }
    if (!isValidInvitationWhatsApp(whatsapp)) {
      setErrorMessage("Informe um WhatsApp valido ou deixe o campo vazio.");
      return;
    }
    if (Array.from(password).length < 8 || Array.from(password).length > 128) {
      setErrorMessage("A senha precisa ter entre 8 e 128 caracteres.");
      return;
    }
    if (password !== passwordConfirm) {
      setErrorMessage("As senhas nao conferem.");
      return;
    }
    if (!termsAccepted || !privacyAccepted) {
      setErrorMessage("Aceite os termos e a politica de privacidade para continuar.");
      return;
    }

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
      setIsSubmitting(false);
      return;
    }

    if (result.requiresLogin) {
      setRequiresLogin(true);
      setStatusMessage(result.message || "Entre com sua conta para aceitar este convite.");
      setIsSubmitting(false);
      return;
    }
    if (!isConfirmedInvitationAcceptance(result)) {
      setErrorMessage(result.message || "Não foi possível confirmar o aceite do convite.");
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
    setIsSubmitting(false);
  }

  async function handleAcceptExistingAccount() {
    setErrorMessage(null);
    setStatusMessage(null);
    if (!termsAccepted || !privacyAccepted) {
      setErrorMessage("Aceite os termos e a política de privacidade para continuar.");
      return;
    }
    if (!canonicalToken) {
      setErrorMessage("Link de convite inválido.");
      return;
    }
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
        setIsSubmitting(false);
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível aceitar o convite agora.");
      setIsSubmitting(false);
      return;
    }
    if (!isConfirmedInvitationAcceptance(result)) {
      setErrorMessage(result.message || "Não foi possível confirmar o aceite do convite.");
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
    <div className="w-full max-w-sm">
      <header className="mb-5 text-center">
        <AuthLogo width={138} />
        <h1 className="sr-only">Aceitar convite do Vimob CRM</h1>
        <p className="mt-4 text-[13px] font-light text-white/70">
          Aceite o convite para acessar o Vimob CRM
        </p>
      </header>

      <div className="rounded-[8px] bg-[var(--auth-hero-panel-strong)] p-4 shadow-none">
        {confirmedInvitation ? (
          <div className="space-y-4 py-8 text-center" role="status">
            <h2 className={invitationStateTitleClass}>Convite aceito</h2>
            <p className={invitationStateTextClass}>
              {confirmedInvitation.message}
            </p>
            <p className="text-[11px] font-light leading-5 text-white/50">
              Seu acesso a {confirmedInvitation.organizationName} já foi confirmado.
            </p>
            <Link
              href={confirmedInvitation.nextStep === "login" ? postAcceptanceLoginPath : selectOrganizationPath}
              className={invitationActionClass}
            >
              {confirmedInvitation.nextStep === "login" ? "Entrar" : "Continuar"}
            </Link>
          </div>
        ) : invitationState === "loading" ? (
          <div
            className="flex h-72 items-center justify-center"
            role="status"
            aria-label="Carregando convite"
          >
            <Loader2 className="h-5 w-5 animate-spin text-white/65" />
          </div>
        ) : invitationState === "unavailable" ? (
          <div className="space-y-4 py-8 text-center">
            <h2 className={invitationStateTitleClass}>Consulta indisponível</h2>
            <p className={invitationStateTextClass}>
              Não foi possível consultar este convite agora. Seu link não foi invalidado.
            </p>
            <button
              type="button"
              onClick={() => void retryLookup()}
              disabled={isRetryingLookup}
              className={invitationActionClass}
            >
              {isRetryingLookup ? "Tentando novamente..." : "Tentar novamente"}
            </button>
          </div>
        ) : invitationState === "invalid" ? (
          <div className="space-y-4 py-8 text-center">
            <h2 className={invitationStateTitleClass}>Link de convite inválido</h2>
            <p className={invitationStateTextClass}>
              Confira se o link foi copiado por completo ou solicite um novo convite.
            </p>
            <Link href="/login" className={invitationActionClass}>
              Ir para login
            </Link>
          </div>
        ) : invitationState === "expired" ? (
          <div className="space-y-4 py-8 text-center">
            <h2 className={invitationStateTitleClass}>Convite expirado ou já utilizado</h2>
            <p className={invitationStateTextClass}>
              Solicite um novo convite ao administrador da organização.
            </p>
            <Link href="/login" className={invitationActionClass}>
              Ir para login
            </Link>
          </div>
        ) : invitation ? (
          <form
            onSubmit={handleAcceptNewAccount}
            className="space-y-4"
            aria-busy={isSubmitting}
          >
            <div className="rounded-[6px] bg-[var(--auth-hero-panel)] p-3 text-[13px] font-light text-white/70 shadow-none">
              <p className="font-normal text-white">Convite para {organizationName}</p>
              <p className="mt-1 text-white/55">{email}</p>
              <p className="mt-1 text-white/55">Função: {roleLabel}</p>
            </div>

            {existingAccount ? (
              <div className="space-y-3">
                <div className="rounded-[6px] bg-[var(--auth-hero-panel)] p-3 text-[12px] font-light leading-5 text-white/65 shadow-none">
                  {checkingSession ? (
                    "Verificando sua sessão..."
                  ) : loggedEmailMatches ? (
                    "Você já está conectado com este e-mail. Confirme para entrar nesta organização."
                  ) : currentUserEmail ? (
                    <>
                      Você está conectado como <span className="text-white">{currentUserEmail}</span>. Saia e entre com{" "}
                      <span className="text-white">{email}</span> para aceitar o convite.
                    </>
                  ) : (
                    "Este e-mail já possui uma conta Vimob. Entre com seu acesso atual para aceitar o convite."
                  )}
                </div>
                {loggedEmailMatches ? (
                  <div className="space-y-2 pt-1">
                    <InvitationConsentCheckbox
                      id="existing-invitation-terms"
                      name="existingTermsAccepted"
                      checked={termsAccepted}
                      onCheckedChange={setTermsAccepted}
                      prefix="Li e aceito os"
                      href="/termos-de-uso"
                      linkLabel="Termos de Uso"
                      version={CURRENT_TERMS_VERSION}
                    />
                    <InvitationConsentCheckbox
                      id="existing-invitation-privacy"
                      name="existingPrivacyAccepted"
                      checked={privacyAccepted}
                      onCheckedChange={setPrivacyAccepted}
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
                  <label htmlFor="invitation-name" className="block text-[13px] font-light text-white">
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
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={Boolean(errorMessage)}
                    aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                    className={invitationFieldClass}
                    placeholder="Seu nome"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="invitation-whatsapp" className="block text-[13px] font-light text-white">
                    WhatsApp
                  </label>
                  <input
                    id="invitation-whatsapp"
                    name="whatsapp"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={40}
                    value={whatsapp}
                    onChange={(event) => setWhatsapp(event.target.value)}
                    aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                    className={invitationFieldClass}
                    placeholder="+55 (00) 00000-0000"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="invitation-password" className="block text-[13px] font-light text-white">
                      Senha
                    </label>
                    <input
                      id="invitation-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-invalid={Boolean(errorMessage)}
                      aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                      className={invitationFieldClass}
                      placeholder="Mín. 8 caracteres"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="invitation-password-confirm" className="block text-[13px] font-light text-white">
                      Confirmar
                    </label>
                    <input
                      id="invitation-password-confirm"
                      name="passwordConfirm"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                      value={passwordConfirm}
                      onChange={(event) => setPasswordConfirm(event.target.value)}
                      aria-invalid={Boolean(errorMessage)}
                      aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                      className={invitationFieldClass}
                      placeholder="Repita a senha"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <InvitationConsentCheckbox
                    id="invitation-terms"
                    name="termsAccepted"
                    checked={termsAccepted}
                    onCheckedChange={setTermsAccepted}
                    prefix="Li e aceito os"
                    href="/termos-de-uso"
                    linkLabel="Termos de Uso"
                    version={CURRENT_TERMS_VERSION}
                  />
                  <InvitationConsentCheckbox
                    id="invitation-privacy"
                    name="privacyAccepted"
                    checked={privacyAccepted}
                    onCheckedChange={setPrivacyAccepted}
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
                errorMessage ? "text-destructive" : "text-white/60",
              )}
              role={errorMessage ? "alert" : "status"}
            >
              {errorMessage || statusMessage}
            </p>
          </form>
        ) : null}
      </div>
    </div>
  );
}
