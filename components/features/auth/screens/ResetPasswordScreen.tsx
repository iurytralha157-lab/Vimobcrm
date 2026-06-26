'use client';

import { useState, useMemo, useEffect } from "react";
import NextImage from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { Eye, EyeOff, Check, ShieldAlert, Lock } from "lucide-react";
import { useTheme } from "next-themes";
import { useToast } from "@/hooks/use-toast";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { usePasswordStrength, type PasswordStrength } from "@/hooks/use-password-strength";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VimobLoader } from "@/components/shared/loading";
import { supabase } from "@/integrations/supabase/client";
import { settingsAPI } from "@/lib/api/settings";
import { getFriendlyErrorMessage } from "@/lib/error-handler";

const STRENGTH_COLORS: Record<PasswordStrength['level'], string> = {
  'very-weak': 'bg-red-500',
  'weak': 'bg-orange-500',
  'fair': 'bg-yellow-500',
  'good': 'bg-lime-500',
  'strong': 'bg-green-500',
};

const STRENGTH_LABELS: Record<PasswordStrength['level'], string> = {
  'very-weak': 'Muito fraca',
  'weak': 'Fraca',
  'fair': 'Razoável',
  'good': 'Boa',
  'strong': 'Forte',
};

const resetSchema = z.object({
  password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

export default function ResetPassword() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const { data: systemSettings, isLoading: settingsLoading } = useSystemSettings();

  const [loading, setLoading] = useState(false);
  const [validatingSession, setValidatingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [bgLoaded, setBgLoaded] = useState(false);

  const logoUrl = useMemo(() => {
    if (!systemSettings) return null;
    return resolvedTheme === 'dark'
      ? systemSettings.logo_url_dark || systemSettings.logo_url_light
      : systemSettings.logo_url_light || systemSettings.logo_url_dark;
  }, [systemSettings, resolvedTheme]);

  const loginBgUrl = useMemo(() => {
    if (!systemSettings) return null;
    return systemSettings.login_bg_url || null;
  }, [systemSettings]);

  // Pre-load background image only on desktop (mobile uses CSS gradient to save 500KB+)
  useEffect(() => {
    if (!loginBgUrl) return;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) return;
    const img = new Image();
    img.onload = () => setBgLoaded(true);
    img.src = loginBgUrl;
  }, [loginBgUrl]);

  const passwordStrength = usePasswordStrength(password);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      if (tokenHash && type === 'recovery') {
        try {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });

          if (error) {
            console.error("Error verifying token hash:", error);
          } else if (mounted) {
            setHasRecoverySession(true);
            setValidatingSession(false);
            return;
          }
        } catch (err) {
          console.error("Unexpected error verifying token hash:", err);
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        if (session) {
          setHasRecoverySession(true);
        }
        setValidatingSession(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        if (mounted) {
          setHasRecoverySession(true);
          setValidatingSession(false);
        }
      }
    });

    checkSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const parsed = resetSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[String(err.path[0])] = err.message;
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
      const data = await settingsAPI.changePassword({
        password,
        source: "recovery",
      });
      if (data?.allowed === false) {
        const message = data.message || "Não foi possível alterar sua senha agora.";
        setErrors({ password: message });
        toast({
          title: "Alteração bloqueada",
          description: message,
          variant: "destructive",
        });
        return;
      }

      setSuccess(true);
      toast({
        title: "Senha alterada com sucesso!",
        description: "Você já pode fazer login com a nova senha.",
      });

      await supabase.auth.signOut();

      setTimeout(() => router.replace('/login'), 2000);
    } catch (err) {
      toast({
        title: "Erro ao alterar senha",
        description: getFriendlyErrorMessage(err),
        variant: "destructive",
      });
      setErrors({ password: getFriendlyErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  if (settingsLoading || validatingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <VimobLoader size="lg" label="Validando acesso..." />
      </div>
    );
  }

  const showBg = loginBgUrl && bgLoaded;

  return (
    <div className="dark min-h-screen flex flex-col lg:flex-row bg-background relative overflow-x-hidden">
      {/* Mobile background: full screen background on mobile */}
      <div className="lg:hidden absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        {loginBgUrl ? (
          <div className="relative w-full h-full">
            <NextImage
              src={loginBgUrl.includes('supabase.co') ? `${loginBgUrl}?width=800&quality=60&format=webp` : loginBgUrl}
              alt=""
              fill
              sizes="100vw"
              className="object-cover object-center opacity-100"
              priority
              unoptimized
            />
            {/* Vertical gradient similar to desktop horizontal gradient */}
            <div className="absolute inset-x-0 bottom-0 h-[80%] bg-gradient-to-t from-background via-background/90 to-transparent" />
          </div>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/10 via-background to-background" />
        )}
      </div>

      {/* Form container */}
      <div className="w-full lg:w-[420px] xl:w-[460px] flex flex-col items-center justify-center px-8 py-8 lg:py-10 flex-shrink-0 mx-auto lg:ml-[100px] xl:ml-[100px] flex-1 lg:flex-none relative z-10">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-2">
            {logoUrl && (
              <NextImage
                src={logoUrl}
                alt="Logo"
                width={160}
                height={56}
                className="h-14 w-auto mb-2"
                priority
                unoptimized
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground text-center mb-6">
            {hasRecoverySession
              ? 'Defina sua nova senha de acesso'
              : 'Recuperação de senha'}
          </p>

          {!hasRecoverySession ? (
            <div className="space-y-5">
              <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-xl flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                <div className="text-sm text-destructive">
                  <p className="font-semibold mb-1">Link inválido ou expirado</p>
                  <p className="text-xs opacity-90">
                    Este link de recuperação não é mais válido. Solicite um novo link de redefinição de senha.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => router.push('/login')}
                className="w-full h-11 rounded-xl font-semibold uppercase tracking-wider text-xs"
              >
                Voltar para o login
              </Button>
            </div>
          ) : success ? (
            <div className="space-y-5 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Check className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm text-foreground">
                Senha alterada com sucesso! Redirecionando para o login...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <Label htmlFor="password" className="text-sm text-foreground">Nova senha</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                    disabled={loading}
                    className="h-11 rounded-xl bg-muted pl-11 pr-12"
                    aria-invalid={!!errors.password}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {password && (
                  <div className="space-y-1.5 mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i <= passwordStrength.score
                              ? STRENGTH_COLORS[passwordStrength.level]
                              : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Força: <span className="font-medium">{STRENGTH_LABELS[passwordStrength.level]}</span>
                    </p>
                    {passwordStrength.feedback.length > 0 && !passwordStrength.isValid && (
                      <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        {passwordStrength.feedback.map((f, i) => (
                          <li key={i}>• {f}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {errors.password && (
                  <p className="text-xs text-destructive mt-1" role="alert">{errors.password}</p>
                )}
              </div>

              <div>
                <Label htmlFor="confirmPassword" className="text-sm text-foreground">Confirmar nova senha</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    autoComplete="new-password"
                    disabled={loading}
                    className="h-11 rounded-xl bg-muted pl-11 pr-12"
                    aria-invalid={!!errors.confirmPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-xs text-destructive mt-1" role="alert">{errors.confirmPassword}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11 rounded-xl font-semibold uppercase tracking-wider text-xs"
                disabled={loading || !passwordStrength.isValid || password !== confirmPassword}
              >
                {loading && <VimobLoader size="sm" className="mr-2" label="Alterando senha..." />}
                Alterar senha
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => router.push('/login')}
                  disabled={loading}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Right panel - Background image (desktop only, lazy-loaded) */}
      {showBg && (
        <div className="hidden lg:block flex-1 relative">
          <NextImage
            src={loginBgUrl!}
            alt=""
            aria-hidden="true"
            role="presentation"
            fill
            sizes="(min-width: 1024px) calc(100vw - 420px), 100vw"
            className="object-cover"
            unoptimized
          />
          <div className="absolute inset-y-0 left-0 w-72 bg-gradient-to-r from-background via-background/80 to-transparent pointer-events-none" />
        </div>
      )}
    </div>
  );
}
