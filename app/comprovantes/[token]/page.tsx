import type { Metadata } from "next";
import {
  BadgeCheck,
  CircleAlert,
  CircleX,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";

import {
  PublicDocument,
  PublicHero,
  PublicPageShell,
} from "@/components/features/public";
import {
  getBillingPeriodLabel,
  getBillingTypeLabel,
  type PublicBillingPaymentReceipt,
} from "@/lib/billing/payment-receipt";
import { verifyPublicBillingPaymentReceipt } from "@/lib/billing/payment-receipt.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verificação de comprovante | Vimob",
  description:
    "Verificação pública de comprovante de pagamento emitido pelo Vimob.",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

type ReceiptVerificationPageProps = {
  params: Promise<{ token: string }>;
};

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amount);
}

function ReceiptDetail({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="space-y-1 border-b border-[var(--public-border)] pb-4 last:border-b-0 sm:last:border-b">
      <dt className="text-[11px] font-light text-[var(--public-tertiary)]">
        {label}
      </dt>
      <dd className="break-words text-sm font-normal text-[var(--public-foreground)]">
        {value}
      </dd>
    </div>
  );
}

function ValidReceipt({
  receipt,
}: Readonly<{ receipt: PublicBillingPaymentReceipt }>) {
  return (
    <>
      <PublicHero
        compact
        eyebrow="Verificação de pagamento"
        title="Comprovante confirmado"
      />

      <PublicDocument>
        <div className="space-y-7">
          <div className="flex flex-col gap-4 border-b border-[var(--public-border)] pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-emerald-50 text-emerald-600">
                <BadgeCheck className="h-5 w-5" strokeWidth={1.7} />
              </span>
              <div>
                <p className="text-sm font-normal text-[var(--public-foreground)]">
                  Pagamento registrado com sucesso
                </p>
                <p className="mt-1 text-xs font-light text-[var(--public-muted)]">
                  Registro verificado diretamente na base do Vimob.
                </p>
              </div>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-[6px] bg-[var(--public-soft)] px-3 py-2 text-xs font-light text-[var(--public-muted)]">
              <ShieldCheck
                className="h-4 w-4 text-emerald-600"
                strokeWidth={1.6}
              />
              Registro localizado na base Vimob
            </span>
          </div>

          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <ReceiptDetail
              label="Número do comprovante"
              value={receipt.receipt_number}
            />
            <ReceiptDetail label="Emitido por" value={receipt.issuer_name} />
            <ReceiptDetail
              label="Organização"
              value={receipt.organization_name}
            />
            <ReceiptDetail label="Plano" value={receipt.plan_name} />
            <ReceiptDetail
              label="Período"
              value={getBillingPeriodLabel(receipt.billing_period_months)}
            />
            <ReceiptDetail
              label="Forma de pagamento"
              value={getBillingTypeLabel(receipt.billing_type)}
            />
            <ReceiptDetail
              label="Valor pago"
              value={formatCurrency(receipt.amount, receipt.currency)}
            />
            <ReceiptDetail
              label="Pagamento confirmado em"
              value={dateTimeFormatter.format(new Date(receipt.paid_at))}
            />
            <ReceiptDetail
              label="Comprovante emitido em"
              value={dateTimeFormatter.format(new Date(receipt.issued_at))}
            />
            <ReceiptDetail label="Versão" value={String(receipt.version)} />
          </dl>

          <div className="rounded-[8px] border border-[var(--public-border)] bg-[var(--public-soft)] px-4 py-4">
            <div className="flex items-start gap-3">
              <FileCheck2
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--public-accent)]"
                strokeWidth={1.6}
              />
              <div className="space-y-1.5">
                <p className="text-xs font-normal text-[var(--public-foreground)]">
                  Integridade do registro
                </p>
                <p className="break-all font-mono text-[10px] leading-4 text-[var(--public-tertiary)]">
                  {receipt.snapshot_hash}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-[8px] bg-amber-50 px-4 py-4 text-amber-950">
            <CircleAlert
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={1.6}
            />
            <p className="text-xs font-light leading-5">
              Este comprovante confirma o registro do pagamento no Vimob. Não é
              documento fiscal e não substitui nota fiscal ou documento emitido
              pelo provedor de pagamento. Estornos, reembolsos ou contestações
              posteriores alteram automaticamente o estado exibido nesta
              verificação pública.
            </p>
          </div>
        </div>
      </PublicDocument>
    </>
  );
}

function invalidatedReceiptCopy(receipt: PublicBillingPaymentReceipt) {
  if (receipt.payment_state === "refunded") {
    return {
      title: "Pagamento estornado",
      message:
        "O pagamento deste comprovante foi estornado ou teve reembolso solicitado.",
    };
  }
  if (receipt.payment_state === "chargeback") {
    return {
      title: "Pagamento contestado",
      message:
        "O pagamento deste comprovante esta em processo de chargeback ou contestacao.",
    };
  }
  if (receipt.payment_state === "cancelled") {
    return {
      title: "Pagamento cancelado",
      message: "O pagamento relacionado a este comprovante foi cancelado.",
    };
  }
  return {
    title: "Confirmacao de pagamento invalidada",
    message: "O pagamento nao esta mais em um estado financeiro confirmado.",
  };
}

function InvalidatedReceipt({
  receipt,
}: Readonly<{ receipt: PublicBillingPaymentReceipt }>) {
  const copy = invalidatedReceiptCopy(receipt);

  return (
    <>
      <PublicHero
        compact
        eyebrow="Verificacao de pagamento"
        title={copy.title}
      />

      <PublicDocument>
        <div className="space-y-7">
          <div className="flex items-start gap-3 rounded-[8px] bg-amber-50 px-4 py-4 text-amber-950">
            <CircleAlert
              className="mt-0.5 h-5 w-5 shrink-0"
              strokeWidth={1.6}
            />
            <div className="space-y-1.5">
              <p className="text-sm font-normal">
                Este comprovante nao esta mais valido.
              </p>
              <p className="text-xs font-light leading-5">{copy.message}</p>
            </div>
          </div>

          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <ReceiptDetail
              label="Numero do comprovante"
              value={receipt.receipt_number}
            />
            <ReceiptDetail
              label="Organizacao"
              value={receipt.organization_name}
            />
            <ReceiptDetail label="Plano" value={receipt.plan_name} />
            <ReceiptDetail
              label="Valor originalmente registrado"
              value={formatCurrency(receipt.amount, receipt.currency)}
            />
            <ReceiptDetail
              label="Pagamento originalmente registrado em"
              value={dateTimeFormatter.format(new Date(receipt.paid_at))}
            />
            <ReceiptDetail
              label="Estado financeiro atualizado em"
              value={dateTimeFormatter.format(
                new Date(receipt.state_changed_at),
              )}
            />
          </dl>

          <p className="text-xs font-light leading-5 text-[var(--public-muted)]">
            O registro original permanece preservado para auditoria, mas a
            situacao atual do pagamento prevalece sobre a confirmacao emitida
            anteriormente.
          </p>
        </div>
      </PublicDocument>
    </>
  );
}

function InvalidReceipt({
  unavailable = false,
}: Readonly<{ unavailable?: boolean }>) {
  return (
    <>
      <PublicHero
        compact
        eyebrow="Verificação de pagamento"
        title={
          unavailable
            ? "Verificação indisponível"
            : "Comprovante não encontrado"
        }
      />

      <PublicDocument>
        <div className="mx-auto flex max-w-xl flex-col items-center py-4 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[var(--public-soft)] text-[var(--public-tertiary)]">
            {unavailable ? (
              <CircleAlert className="h-5 w-5" strokeWidth={1.5} />
            ) : (
              <CircleX className="h-5 w-5" strokeWidth={1.5} />
            )}
          </span>
          <p className="mt-4 text-sm font-normal text-[var(--public-foreground)]">
            {unavailable
              ? "Não foi possível consultar o comprovante agora."
              : "O link informado não corresponde a um comprovante válido."}
          </p>
          <p className="mt-2 max-w-md text-xs font-light leading-5 text-[var(--public-muted)]">
            {unavailable
              ? "Tente novamente em alguns instantes. Se o problema continuar, fale com o suporte do Vimob."
              : "Confira se o endereço foi copiado por completo. Por segurança, nenhum dado de cobrança foi exibido."}
          </p>
        </div>
      </PublicDocument>
    </>
  );
}

export default async function ReceiptVerificationPage({
  params,
}: ReceiptVerificationPageProps) {
  const { token } = await params;
  const result = await verifyPublicBillingPaymentReceipt(token);

  return (
    <PublicPageShell>
      {result.status === "valid" ? (
        <ValidReceipt receipt={result.receipt} />
      ) : result.status === "invalidated" ? (
        <InvalidatedReceipt receipt={result.receipt} />
      ) : (
        <InvalidReceipt unavailable={result.status === "unavailable"} />
      )}
    </PublicPageShell>
  );
}
