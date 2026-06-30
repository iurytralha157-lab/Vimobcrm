"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { adminAPI } from "@/lib/api/admin";
import { authAPI } from "@/lib/api/auth";
import { useInvitationByToken } from "@/hooks/use-invitation-by-token";
import { cn } from "@/lib/utils";

type AcceptResult = {
  success: boolean;
  requiresLogin: boolean;
  email: string;
  organizationId: string;
  organizationName: string;
  message?: string;
};

function VimobLogo() {
  return (
    <Image
      src="/images/logo-white.png"
      alt="Vimob"
      width={1228}
      height={429}
      priority
      className="mx-auto"
      style={{ width: "138px", height: "auto" }}
    />
  );
}

export function InvitationScreen({ token }: { token: string }) {
  const router = useRouter();
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

  const email = invitation?.email || "";
  const organizationName = invitation?.organization_name || "sua imobiliaria";
  const roleLabel = useMemo(() => (invitation?.role === "admin" ? "Administrador" : "Usuario"), [invitation?.role]);

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
        router.replace(`/login?email=${encodeURIComponent(email)}`);
        return;
      }

      router.replace("/dashboard");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel aceitar o convite agora.");
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
      router.replace("/select-organization?redirectTo=/dashboard");
    } catch {
      router.replace(`/login?redirectTo=/convite/${encodeURIComponent(token)}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-page auth-page-dark relative h-dvh max-h-dvh w-full overflow-hidden font-sans">
      <div className="absolute inset-0 z-0 h-full w-full" aria-hidden="true">
        <div className="relative h-full w-full">
          <Image
            src="/images/login-hero.webp"
            alt=""
            fill
            priority
            unoptimized
            className="object-cover object-[63%_center] brightness-[0.55] md:object-[68%_center] md:brightness-[0.82]"
            sizes="100vw"
          />
        </div>
      </div>
      <div className="auth-hero-overlay absolute inset-0 z-[1] h-full w-full" aria-hidden="true" />
      <div className="auth-hero-vignette absolute inset-0 z-[2] h-full w-full" aria-hidden="true" />

      <main className="relative z-10 flex h-full w-full items-center justify-center px-6 py-10">
        <section className="w-full max-w-sm">
          <header className="mb-5 text-center">
            <VimobLogo />
            <p className="mt-4 text-sm font-extralight tracking-wide text-white/60">
              Aceite o convite para acessar o Vimob CRM
            </p>
          </header>

          <div className="rounded-[8px] bg-black/24 p-4 backdrop-blur-sm">
            {isLoading ? (
              <div className="flex h-72 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-white/60" />
              </div>
            ) : !invitation ? (
              <div className="space-y-4 py-8 text-center">
                <h1 className="text-xl font-extralight text-white">Convite expirado</h1>
                <p className="text-sm font-extralight leading-6 text-white/60">
                  Solicite um novo convite ao administrador da organizacao.
                </p>
                <Link
                  href="/login"
                  className="inline-flex h-11 items-center justify-center rounded-[6px] bg-[#FF4529] px-5 text-xs uppercase tracking-[0.08em] text-white"
                >
                  Ir para login
                </Link>
              </div>
            ) : (
              <form onSubmit={handleAcceptNewAccount} className="space-y-4">
                <div className="rounded-[6px] bg-white/[0.08] p-3 text-sm font-extralight text-white/70">
                  <p className="text-white">Convite para {organizationName}</p>
                  <p className="mt-1 text-white/55">{email}</p>
                  <p className="mt-1 text-white/55">Funcao: {roleLabel}</p>
                </div>

                {requiresLogin ? (
                  <button
                    type="button"
                    onClick={handleAcceptExistingAccount}
                    disabled={isSubmitting}
                    className="h-12 w-full rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90 disabled:opacity-55"
                  >
                    {isSubmitting ? "Verificando..." : "Entrar e aceitar convite"}
                  </button>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="block text-sm font-extralight text-white">Nome completo</label>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                        placeholder="Seu nome"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-extralight text-white">WhatsApp</label>
                      <input
                        value={whatsapp}
                        onChange={(event) => setWhatsapp(event.target.value)}
                        className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                        placeholder="+55 (00) 00000-0000"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="block text-sm font-extralight text-white">Senha</label>
                        <input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                          placeholder="Min. 8 caracteres"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-sm font-extralight text-white">Confirmar</label>
                        <input
                          type="password"
                          value={passwordConfirm}
                          onChange={(event) => setPasswordConfirm(event.target.value)}
                          className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 text-sm font-extralight text-white outline-none placeholder:text-white/30"
                          placeholder="Repita a senha"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 pt-1">
                      <label className="flex cursor-pointer items-start gap-3 text-xs font-extralight leading-5 text-white/68">
                        <input
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
                          type="checkbox"
                          checked={privacyAccepted}
                          onChange={(event) => setPrivacyAccepted(event.target.checked)}
                          className="mt-1"
                        />
                        <span>
                          Li e aceito a <Link href="/politica-de-privacidade" className="text-[#FF4529]">Politica de Privacidade</Link>.
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="h-12 w-full rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90 disabled:opacity-55"
                    >
                      {isSubmitting ? "Finalizando..." : "Aceitar convite"}
                    </button>
                  </>
                )}

                <p
                  className={cn(
                    "min-h-5 text-center text-sm font-extralight leading-5",
                    errorMessage ? "text-[#FF4529]" : "text-white/60",
                  )}
                  aria-live="polite"
                >
                  {errorMessage || statusMessage}
                </p>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
