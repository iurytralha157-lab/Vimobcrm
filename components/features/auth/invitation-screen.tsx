"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { adminAPI } from "@/lib/api/admin";
import { authAPI } from "@/lib/api/auth";
import { supabase } from "@/integrations/supabase/client";
import { useInvitationByToken } from "@/hooks/use-invitation-by-token";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
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

export function InvitationScreen({ token }: { token: string }) {
  const router = useRouter();
  const { refreshOrganizations } = useAuth();
  const { data: invitation, isLoading } = useInvitationByToken(token);
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

  const email = invitation?.email || "";
  const organizationName = invitation?.organization_name || "sua imobiliaria";
  const roleLabel = useMemo(() => (invitation?.role === "admin" ? "Administrador" : "Usuario"), [invitation?.role]);
  const existingAccount = Boolean(invitation?.existing_account || requiresLogin);
  const loggedEmailMatches = Boolean(
    currentUserEmail && email && currentUserEmail.toLowerCase() === email.toLowerCase(),
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setCurrentUserEmail(data.user?.email ?? null);
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

    if (!invitation || !email) {
      setErrorMessage("Convite invalido ou expirado.");
      return;
    }
    if (!name.trim()) {
      setErrorMessage("Informe seu nome para continuar.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("A senha precisa ter pelo menos 8 caracteres.");
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
    try {
      const result = await adminAPI.acceptInvitationPublic<AcceptResult>(token, {
        name: name.trim(),
        password,
        whatsapp: whatsapp.trim() || null,
        termsAccepted,
        privacyAccepted,
      });

      if (result.requiresLogin) {
        setRequiresLogin(true);
        setStatusMessage(result.message || "Entre com sua conta para aceitar este convite.");
        return;
      }

      const { error } = await authAPI.login(email, password);
      if (error) {
        setStatusMessage("Convite aceito. Entre com sua nova senha para acessar.");
        router.replace("/login");
        return;
      }

      router.replace("/select-organization?redirectTo=/dashboard");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível aceitar o convite agora.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAcceptExistingAccount() {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    try {
      const result = await adminAPI.acceptInvitationAuthenticated<AcceptResult>(token);
      setStatusMessage(result.message || "Convite aceito.");
      await refreshOrganizations();
      router.replace("/select-organization?redirectTo=/dashboard");
    } catch {
      router.replace(`/login?redirectTo=/convite/${encodeURIComponent(token)}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLoginForInvitation() {
    await supabase.auth.signOut();
    router.replace(`/login?redirectTo=/convite/${encodeURIComponent(token)}`);
  }

  return (
    <div className="w-full max-w-sm">
          <header className="mb-5 text-center">
            <AuthLogo width={138} />
            <h1 className="sr-only">Aceitar convite do Vimob CRM</h1>
            <p className="mt-4 text-sm font-extralight tracking-wide text-white/60">
              Aceite o convite para acessar o Vimob CRM
            </p>
          </header>

          <div className="rounded-[8px] bg-black/24 p-4 backdrop-blur-sm">
            {isLoading ? (
              <div
                className="flex h-72 items-center justify-center"
                role="status"
                aria-label="Carregando convite"
              >
                <Loader2 className="h-5 w-5 animate-spin text-white/60" />
              </div>
            ) : !invitation ? (
              <div className="space-y-4 py-8 text-center">
                <h2 className="text-xl font-extralight text-white">Convite expirado</h2>
                <p className="text-sm font-extralight leading-6 text-white/60">
                  Solicite um novo convite ao administrador da organização.
                </p>
                <Link
                  href="/login"
                  className="auth-primary-action inline-flex h-11 items-center justify-center rounded-[6px] px-5 text-xs uppercase tracking-[0.08em] transition-colors"
                >
                  Ir para login
                </Link>
              </div>
            ) : (
              <form
                onSubmit={handleAcceptNewAccount}
                className="space-y-4"
                aria-busy={isSubmitting}
              >
                <div className="rounded-[6px] bg-white/[0.08] p-3 text-sm font-extralight text-white/70">
                  <p className="text-white">Convite para {organizationName}</p>
                  <p className="mt-1 text-white/55">{email}</p>
                  <p className="mt-1 text-white/55">Funcao: {roleLabel}</p>
                </div>

                {existingAccount ? (
                  <div className="space-y-3">
                    <div className="rounded-[6px] bg-white/[0.06] p-3 text-sm font-extralight leading-6 text-white/65">
                      {checkingSession ? (
                        "Verificando sua sessao..."
                      ) : loggedEmailMatches ? (
                        "Você já está conectado com este e-mail. Confirme para entrar nesta organização."
                      ) : currentUserEmail ? (
                        <>
                          Você está conectado como <span className="text-white">{currentUserEmail}</span>. Saia e entre com{" "}
                          <span className="text-white">{email}</span> para aceitar o convite.
                        </>
                      ) : (
                        "Este e-mail ja possui uma conta Vimob. Entre com seu acesso atual para aceitar o convite."
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={loggedEmailMatches ? handleAcceptExistingAccount : handleLoginForInvitation}
                      disabled={isSubmitting || checkingSession}
                      className="auth-primary-action h-12 w-full rounded-[6px] text-[12px] font-extralight uppercase tracking-[0.08em] transition-colors disabled:opacity-55"
                    >
                      {isSubmitting ? "Verificando..." : loggedEmailMatches ? "Aceitar convite" : "Entrar para aceitar"}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="invitation-name" className="block text-sm font-extralight text-white">
                        Nome completo
                      </label>
                      <input
                        id="invitation-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        required
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        aria-invalid={Boolean(errorMessage)}
                        aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                        className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                        placeholder="Seu nome"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="invitation-whatsapp" className="block text-sm font-extralight text-white">
                        WhatsApp
                      </label>
                      <input
                        id="invitation-whatsapp"
                        name="whatsapp"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={whatsapp}
                        onChange={(event) => setWhatsapp(event.target.value)}
                        aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                        className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                        placeholder="+55 (00) 00000-0000"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor="invitation-password" className="block text-sm font-extralight text-white">
                          Senha
                        </label>
                        <input
                          id="invitation-password"
                          name="password"
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          required
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          aria-invalid={Boolean(errorMessage)}
                          aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                          className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                          placeholder="Min. 8 caracteres"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="invitation-password-confirm" className="block text-sm font-extralight text-white">
                          Confirmar
                        </label>
                        <input
                          id="invitation-password-confirm"
                          name="passwordConfirm"
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          required
                          value={passwordConfirm}
                          onChange={(event) => setPasswordConfirm(event.target.value)}
                          aria-invalid={Boolean(errorMessage)}
                          aria-describedby={errorMessage ? "invitation-form-message" : undefined}
                          className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                          placeholder="Repita a senha"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 pt-1">
                      <label className="flex cursor-pointer items-start gap-3 text-xs font-extralight leading-5 text-white/68">
                        <input
                          id="invitation-terms"
                          name="termsAccepted"
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(event) => setTermsAccepted(event.target.checked)}
                          className="mt-1"
                        />
                        <span>
                          Li e aceito os <Link href="/termos-de-uso" className="text-[#FF4529]">Termos de Uso</Link>.
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 text-xs font-extralight leading-5 text-white/68">
                        <input
                          id="invitation-privacy"
                          name="privacyAccepted"
                          type="checkbox"
                          checked={privacyAccepted}
                          onChange={(event) => setPrivacyAccepted(event.target.checked)}
                          className="mt-1"
                        />
                        <span>
                          Li e aceito a <Link href="/politica-de-privacidade" className="text-[#FF4529]">Política de Privacidade</Link>.
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="auth-primary-action h-12 w-full rounded-[6px] text-[12px] font-extralight uppercase tracking-[0.08em] transition-colors disabled:opacity-55"
                    >
                      {isSubmitting ? "Finalizando..." : "Aceitar convite"}
                    </button>
                  </>
                )}

                <p
                  id="invitation-form-message"
                  className={cn(
                    "min-h-5 text-center text-sm font-extralight leading-5",
                    errorMessage ? "text-[#FF4529]" : "text-white/60",
                  )}
                  role={errorMessage ? "alert" : "status"}
                >
                  {errorMessage || statusMessage}
                </p>
              </form>
            )}
          </div>
    </div>
  );
}
