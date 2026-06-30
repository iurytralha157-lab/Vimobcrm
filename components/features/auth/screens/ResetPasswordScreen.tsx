'use client';

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { AlertCircle, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { ROUTES } from "@/config/constants";
import { useToast } from "@/hooks/use-toast";
import { usePasswordStrength, type PasswordStrength } from "@/hooks/use-password-strength";
import { VimobLoader } from "@/components/shared/loading";
import { supabase } from "@/integrations/supabase/client";
import { settingsAPI } from "@/lib/api/settings";
import { getFriendlyErrorMessage } from "@/lib/error-handler";

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

function VimobLogo() {
  return (
    <Image
      src="/images/logo-white.png"
      alt="Vimob"
      width={1228}
      height={429}
      priority
      className="mx-auto"
      style={{ width: "148px", height: "auto" }}
    />
  );
}

export default function ResetPasswordScreen() {
  const router = useRouter();
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

    const markReady = () => {
      if (!mounted) return;
      setRecoveryState("ready");
      setValidationMessage(null);
    };

    const markInvalid = (message: string) => {
      if (!mounted) return;
      setRecoveryState("invalid");
      setValidationMessage(message);
    };

    const markReadyFromExistingSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return false;

      cleanRecoveryUrl();
      markReady();
      return true;
    };

    const establishRecoverySession = async () => {
      if (mounted) {
        setRecoveryState("checking");
        setValidationMessage(null);
      }

      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      const hashParams = readRecoveryHash();
      const hashError = hashParams?.get("error_description") || hashParams?.get("error");
      const accessToken = hashParams?.get("access_token");
      const refreshToken = hashParams?.get("refresh_token");

      if (hashError) {
        cleanRecoveryUrl();
        markInvalid(hashError);
        return;
      }

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;

          cleanRecoveryUrl();
          markReady();
          return;
        }

        if (tokenHash && type === "recovery") {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (error) throw error;

          cleanRecoveryUrl();
          markReady();
          return;
        }

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;

          cleanRecoveryUrl();
          markReady();
          return;
        }

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;

        if (session) {
          markReady();
          return;
        }

        markInvalid("Este link de recuperação não é mais válido. Solicite um novo link de redefinição de senha.");
      } catch (error) {
        if (await markReadyFromExistingSession()) return;

        console.error("Error validating password recovery session:", error);
        cleanRecoveryUrl();
        markInvalid(authValidationErrorMessage(error));
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        markReady();
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

      setEmailNotificationSent(result?.emailNotificationSent ?? null);
      setRecoveryState("success");
      setPassword("");
      setConfirmPassword("");

      toast({
        title: "Senha alterada com sucesso",
        description:
          result?.emailNotificationSent === false
            ? "Você já pode entrar com a nova senha."
            : "Enviamos um aviso de segurança para o seu e-mail.",
      });

      await supabase.auth.signOut();
      setTimeout(() => router.replace(ROUTES.LOGIN), 2600);
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
    <div className="auth-page auth-page-dark relative h-dvh max-h-dvh w-full overflow-hidden font-sans">
      <div className="absolute inset-0 z-0 h-full w-full" aria-hidden="true">
        <div className="relative h-full w-full">
          <Image
            src="/images/login-hero.webp"
            alt=""
            fill
            priority
            unoptimized
            className="object-cover object-[63%_center] brightness-[0.6] md:object-[68%_center] md:brightness-[0.88]"
            sizes="100vw"
          />
        </div>
      </div>

      <div className="auth-hero-overlay absolute inset-0 z-[1] h-full w-full" aria-hidden="true" />
      <div className="auth-hero-vignette absolute inset-0 z-[2] h-full w-full" aria-hidden="true" />

      <div className="relative z-10 flex h-full w-full">
        <section className="flex w-full items-center justify-center px-8 py-16 lg:w-[45%] lg:px-16 xl:w-[42%]">
          <div className="w-full max-w-sm">
            <header className="mb-4 text-center">
              <VimobLogo />
              <p className="mt-4 text-sm font-extralight tracking-wide text-white/50">
                {recoveryState === "ready" ? "Defina sua nova senha de acesso" : "Recuperação de senha"}
              </p>
            </header>

            {recoveryState === "checking" ? (
              <div className="flex min-h-[260px] items-center justify-center">
                <VimobLoader size="lg" label="Validando acesso..." />
              </div>
            ) : null}

            {recoveryState === "invalid" ? (
              <div className="space-y-6">
                <div className="rounded-[6px] border border-[#FF4529]/35 bg-[#FF4529]/10 p-4 text-white">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#FF4529]" />
                    <div>
                      <p className="text-sm font-semibold">Link inválido ou expirado</p>
                      <p className="mt-1 text-sm font-extralight leading-6 text-white/72">
                        {validationMessage ||
                          "Solicite um novo link de redefinição de senha para continuar com segurança."}
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => router.push(ROUTES.LOGIN)}
                  className="h-12 w-full cursor-pointer rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90"
                >
                  Voltar para o login
                </button>
              </div>
            ) : null}

            {recoveryState === "success" ? (
              <div className="space-y-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FF4529] text-white">
                  <Check className="h-6 w-6" />
                </div>

                <div className="space-y-3">
                  <h1 className="text-xl font-semibold tracking-wide text-white">Senha alterada com sucesso</h1>
                  <p className="text-sm font-extralight leading-6 text-white/72">
                    Você já pode entrar no Vimob CRM usando a nova senha.
                  </p>
                  <p className="text-sm font-extralight leading-6 text-white/72">
                    {emailNotificationSent === false
                      ? "Não conseguimos confirmar o envio do aviso por e-mail agora."
                      : "Enviamos um aviso de segurança para o seu e-mail."}{" "}
                    Se não foi você, fale imediatamente com{" "}
                    <a href="mailto:contato@vimobcrm.com.br" className="text-[#FF4529] outline-none hover:opacity-80">
                      contato@vimobcrm.com.br
                    </a>
                    .
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs font-extralight tracking-wide text-white/50">
                  <ShieldCheck className="h-4 w-4" />
                  Redirecionando para o login...
                </div>
              </div>
            ) : null}

            {recoveryState === "ready" ? (
              <form method="post" onSubmit={handleSubmit} className="space-y-5">
                <p className="text-sm font-extralight leading-6 tracking-wide text-white/72">
                  Escolha uma senha forte e diferente das que você usa em outros serviços.
                </p>

                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-extralight tracking-wide text-white">
                    Nova senha
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-white/40">
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
                      className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 pl-11 pr-12 text-sm font-extralight tracking-wide text-white outline-none transition-colors placeholder:text-white/30 focus:border-transparent focus:bg-[#121212] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={loading}
                      className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-4 text-white/65 outline-none transition-colors hover:text-white/90 focus-visible:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                              item <= passwordStrength.score ? STRENGTH_COLORS[passwordStrength.level] : "bg-white/15"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs font-extralight text-white/60">
                        Força: <span className="font-medium text-white/75">{STRENGTH_LABELS[passwordStrength.level]}</span>
                      </p>
                      {passwordStrength.feedback.length > 0 && !passwordStrength.isValid ? (
                        <ul className="space-y-1 text-xs font-extralight leading-5 text-white/55">
                          {passwordStrength.feedback.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {errors.password ? (
                    <p className="text-sm font-extralight leading-5 text-[#FF4529]" role="alert">
                      {errors.password}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirmPassword" className="block text-sm font-extralight tracking-wide text-white">
                    Confirmar nova senha
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-white/40">
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
                      className="h-12 w-full rounded-[6px] border border-transparent bg-[#121212] px-4 pl-11 pr-12 text-sm font-extralight tracking-wide text-white outline-none transition-colors placeholder:text-white/30 focus:border-transparent focus:bg-[#121212] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                      disabled={loading}
                      className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-4 text-white/65 outline-none transition-colors hover:text-white/90 focus-visible:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {errors.confirmPassword || passwordMismatch ? (
                    <p className="text-sm font-extralight leading-5 text-[#FF4529]" role="alert">
                      {errors.confirmPassword || "As senhas não coincidem"}
                    </p>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={submitDisabled}
                  className="flex h-12 w-full cursor-pointer items-center justify-center rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {loading ? <VimobLoader size="sm" className="mr-2" label="Alterando senha..." /> : null}
                  Alterar senha
                </button>

                <footer className="text-center text-sm font-extralight tracking-wide">
                  <Link href={ROUTES.LOGIN} className="cursor-pointer text-[#FF4529] outline-none transition-opacity hover:opacity-80">
                    Voltar para o login
                  </Link>
                </footer>
              </form>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
