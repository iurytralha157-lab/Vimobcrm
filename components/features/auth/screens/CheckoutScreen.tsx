'use client';

import { useEffect, useState } from 'react';
import NextImage from 'next/image';
import { useParams, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QrCode, CreditCard, CheckCircle2, Copy } from 'lucide-react';
import { VimobLoader } from '@/components/shared/loading';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { paymentsAPI } from '@/lib/api/payments';
import { settingsAPI } from '@/lib/api/settings';

interface CheckoutInfo {
  organization: {
    id: string;
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    subscription_status: string | null;
    subscription_value: number | null;
  };
  plan: {
    id: string;
    name: string;
    price: number;
    billing_cycle: string | null;
    description: string | null;
  } | null;
}

interface PixResult {
  type: 'PIX';
  payment_id: string;
  invoice_url: string;
  qr_code: string;
  qr_payload: string;
  value: number;
}

interface CardResult {
  type: 'CREDIT_CARD';
  subscription_id: string;
  status: string;
  next_due_date: string;
  value: number;
}

type ChargeRequest = {
  billing_type: 'PIX' | 'CREDIT_CARD';
  holder_email: string;
  holder_cpf_cnpj: string;
  holder_phone: string;
  checkout_token?: string;
  organization_id?: string | null;
  holder_name?: string;
  card_number?: string;
  expiry_month?: string;
  expiry_year?: string;
  ccv?: string;
  holder_postal_code?: string;
  holder_address_number?: string;
};

type ChargeResult =
  | ({ success: true } & PixResult)
  | ({ success: true } & CardResult)
  | { success?: false; error?: string };

type PaymentStatusResponse = {
  payment?: {
    status?: string;
  };
};

type UserBillingUpdate = {
  cpf?: string;
  whatsapp?: string;
  name?: string;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export default function Checkout() {
  const params = useParams<{ token?: string | string[] }>();
  const rawToken = params.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const searchParams = useSearchParams();
  const { user, refreshProfile } = useAuth();
  const orgId = searchParams.get('org');
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const [submitting, setSubmitting] = useState(false);
  const [pixResult, setPixResult] = useState<PixResult | null>(null);
  const [cardResult, setCardResult] = useState<CardResult | null>(null);
  const [paid, setPaid] = useState(false);

  // PIX form
  const [holderEmail, setHolderEmail] = useState('');
  const [holderCpf, setHolderCpf] = useState('');
  const [holderPhone, setHolderPhone] = useState('');

  // Card form
  const [holderName, setHolderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [ccv, setCcv] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [addressNumber, setAddressNumber] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await paymentsAPI.checkoutInfo<CheckoutInfo>(token ? { token } : { organization_id: orgId });
        setInfo(data);
      } catch (error: unknown) {
        toast.error('Erro ao carregar checkout: ' + getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    })();
  }, [token, orgId]);

  // Poll payment status when PIX result is available
  useEffect(() => {
    if (!pixResult?.payment_id || paid) return;
    const t = setInterval(async () => {
      const data = await paymentsAPI.paymentStatus<PaymentStatusResponse>(pixResult.payment_id);
      const status = data?.payment?.status;
      if (status === 'CONFIRMED' || status === 'RECEIVED') {
        setPaid(true);
        clearInterval(t);
        toast.success('Pagamento confirmado! 🎉');
      }
    }, 5000);
    return () => clearInterval(t);
  }, [pixResult, paid]);

  const handleSubmit = async (billingType: 'PIX' | 'CREDIT_CARD') => {
    if (!info) return;
    setSubmitting(true);
    try {
      const body: ChargeRequest = {
        billing_type: billingType,
        holder_email: holderEmail,
        holder_cpf_cnpj: holderCpf,
        holder_phone: holderPhone,
      };
      if (token) body.checkout_token = token;
      else body.organization_id = orgId;

      if (billingType === 'CREDIT_CARD') {
        Object.assign(body, {
          holder_name: holderName,
          card_number: cardNumber,
          expiry_month: expMonth,
          expiry_year: expYear,
          ccv,
          holder_postal_code: postalCode,
          holder_address_number: addressNumber,
        });
      }

      const result = await paymentsAPI.createCharge<ChargeResult>(body as unknown as Record<string, unknown>);
      if (!result?.success) throw new Error(result?.error || 'Falha');

      // Update user profile if logged in
      if (user) {
        const updateData: UserBillingUpdate = {
          cpf: holderCpf || undefined,
          whatsapp: holderPhone || undefined,
        };

        if (billingType === 'CREDIT_CARD') {
          if (holderName) updateData.name = holderName;
        }

        await settingsAPI.updateProfile(updateData);
        await refreshProfile();
      }

      if (billingType === 'PIX') {
        if (result.type !== 'PIX') throw new Error('Resposta Pix invalida');
        setPixResult(result);
      } else {
        if (result.type !== 'CREDIT_CARD') throw new Error('Resposta de cartao invalida');
        setCardResult(result);
        setPaid(true);
        toast.success('Assinatura ativada! 🎉');
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error) || 'Erro ao processar');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <VimobLoader size="lg" label="Carregando checkout..." />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card><CardContent className="p-8 text-center text-muted-foreground">Checkout não encontrado.</CardContent></Card>
      </div>
    );
  }

  if (paid || cardResult) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-primary mx-auto" />
            <h2 className="text-2xl font-semibold">Pagamento confirmado!</h2>
            <p className="text-muted-foreground">
              Sua assinatura do {info.plan?.name} está ativa. Você já pode usar o Vimob normalmente.
            </p>
            <Button asChild className="w-full"><a href="/dashboard">Acessar plataforma</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const value = info.organization.subscription_value && info.organization.subscription_value > 0
    ? info.organization.subscription_value
    : (info.plan?.price || 0);
  const valueFmt = value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center space-y-2">
          {info.organization.logo_url && (
            <NextImage
              src={info.organization.logo_url}
              alt={info.organization.name}
              width={180}
              height={48}
              className="h-12 w-auto mx-auto object-contain"
              unoptimized
            />
          )}
          <CardTitle className="text-xl">{info.organization.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {info.plan?.name} — <span className="font-semibold text-foreground">{valueFmt}</span>
            {info.plan?.billing_cycle === 'monthly' && '/mês'}
          </p>
        </CardHeader>
        <CardContent>
          {pixResult ? (
            <div className="space-y-4 text-center">
              <h3 className="font-medium">Escaneie o QR Code para pagar</h3>
              <NextImage
                src={`data:image/png;base64,${pixResult.qr_code}`}
                alt="QR Pix"
                width={256}
                height={256}
                className="w-64 h-64 mx-auto border rounded-2xl"
                unoptimized
              />
              <div className="flex items-center gap-2">
                <Input value={pixResult.qr_payload} readOnly className="text-xs" />
                <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(pixResult.qr_payload); toast.success('Copiado!'); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
                <VimobLoader size="xs" label="Aguardando pagamento..." /> Aguardando pagamento...
              </p>
              <Button variant="link" asChild><a href={pixResult.invoice_url} target="_blank" rel="noreferrer">Abrir fatura completa</a></Button>
            </div>
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'PIX' | 'CREDIT_CARD')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="PIX"><QrCode className="h-4 w-4 mr-2" />Pix</TabsTrigger>
                <TabsTrigger value="CREDIT_CARD"><CreditCard className="h-4 w-4 mr-2" />Cartão recorrente</TabsTrigger>
              </TabsList>

              <TabsContent value="PIX" className="space-y-4 mt-6">
                <div className="grid gap-3">
                  <div><Label>E-mail</Label><Input type="email" value={holderEmail} onChange={(e) => setHolderEmail(e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>CPF/CNPJ</Label><Input value={holderCpf} onChange={(e) => setHolderCpf(e.target.value)} /></div>
                    <div><Label>Celular</Label><Input value={holderPhone} onChange={(e) => setHolderPhone(e.target.value)} /></div>
                  </div>
                </div>
                <Button onClick={() => handleSubmit('PIX')} disabled={submitting || !holderEmail || !holderCpf} className="w-full">
                  {submitting && <VimobLoader size="sm" className="mr-2" label="Gerando QR Code Pix..." />}Gerar QR Code Pix
                </Button>
              </TabsContent>

              <TabsContent value="CREDIT_CARD" className="space-y-4 mt-6">
                <div className="grid gap-3">
                  <div><Label>Nome no cartão</Label><Input value={holderName} onChange={(e) => setHolderName(e.target.value)} /></div>
                  <div><Label>Número do cartão</Label><Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="0000 0000 0000 0000" /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Mês</Label><Input value={expMonth} onChange={(e) => setExpMonth(e.target.value)} placeholder="MM" maxLength={2} /></div>
                    <div><Label>Ano</Label><Input value={expYear} onChange={(e) => setExpYear(e.target.value)} placeholder="AAAA" maxLength={4} /></div>
                    <div><Label>CVV</Label><Input value={ccv} onChange={(e) => setCcv(e.target.value)} maxLength={4} /></div>
                  </div>
                  <div className="border-t pt-3 mt-2"><p className="text-sm font-medium mb-2">Dados do titular</p></div>
                  <div><Label>E-mail</Label><Input type="email" value={holderEmail} onChange={(e) => setHolderEmail(e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>CPF/CNPJ</Label><Input value={holderCpf} onChange={(e) => setHolderCpf(e.target.value)} /></div>
                    <div><Label>Celular</Label><Input value={holderPhone} onChange={(e) => setHolderPhone(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>CEP</Label><Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} /></div>
                    <div><Label>Número endereço</Label><Input value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} /></div>
                  </div>
                </div>
                <Button onClick={() => handleSubmit('CREDIT_CARD')} disabled={submitting || !cardNumber || !holderName || !ccv} className="w-full">
                  {submitting && <VimobLoader size="sm" className="mr-2" label="Ativando assinatura..." />}Assinar por {valueFmt}/mês
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Cobrança recorrente automática. Você pode cancelar a qualquer momento.
                </p>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
