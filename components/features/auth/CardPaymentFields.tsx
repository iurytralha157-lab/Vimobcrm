'use client';

import { ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CardPaymentFieldsProps = {
  holderName: string;
  holderDocument: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  disabled?: boolean;
  onHolderNameChange: (value: string) => void;
  onHolderDocumentChange: (value: string) => void;
  onNumberChange: (value: string) => void;
  onExpiryMonthChange: (value: string) => void;
  onExpiryYearChange: (value: string) => void;
  onCcvChange: (value: string) => void;
};

function formatCardNumber(value: string) {
  return value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

function onlyDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

export function CardPaymentFields({
  holderName,
  holderDocument,
  number,
  expiryMonth,
  expiryYear,
  ccv,
  disabled = false,
  onHolderNameChange,
  onHolderDocumentChange,
  onNumberChange,
  onExpiryMonthChange,
  onExpiryYearChange,
  onCcvChange,
}: CardPaymentFieldsProps) {
  return (
    <div className="mt-4 space-y-3" aria-describedby="card-security-note">
      <div>
        <Label htmlFor="checkout-card-holder-name" className="text-[12px] font-light text-[var(--app-text-secondary)]">
          Nome impresso no cartão
        </Label>
        <Input
          id="checkout-card-holder-name"
          name="cc-name"
          value={holderName}
          disabled={disabled}
          autoComplete="cc-name"
          placeholder="Como aparece no cartão"
          maxLength={200}
          className="mt-2 h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
          onChange={(event) => onHolderNameChange(event.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="checkout-card-holder-document" className="text-[12px] font-light text-[var(--app-text-secondary)]">
          CPF/CNPJ do titular
        </Label>
        <Input
          id="checkout-card-holder-document"
          name="cc-holder-document"
          value={holderDocument}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Somente números"
          maxLength={18}
          className="mt-2 h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
          onChange={(event) => onHolderDocumentChange(
            event.target.value.replace(/[^\d./-]/g, '').slice(0, 18),
          )}
        />
      </div>

      <div>
        <Label htmlFor="checkout-card-number" className="text-[12px] font-light text-[var(--app-text-secondary)]">
          Número do cartão
        </Label>
        <Input
          id="checkout-card-number"
          name="cc-number"
          value={number}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="0000 0000 0000 0000"
          maxLength={23}
          className="mt-2 h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
          onChange={(event) => onNumberChange(formatCardNumber(event.target.value))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[96px_112px_minmax(0,1fr)]">
        <div>
          <Label htmlFor="checkout-card-expiry-month" className="text-[12px] font-light text-[var(--app-text-secondary)]">
            Mês
          </Label>
          <Input
            id="checkout-card-expiry-month"
            name="cc-exp-month"
            value={expiryMonth}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="cc-exp-month"
            placeholder="MM"
            maxLength={2}
            className="mt-2 h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
            onChange={(event) => onExpiryMonthChange(onlyDigits(event.target.value, 2))}
          />
        </div>
        <div>
          <Label htmlFor="checkout-card-expiry-year" className="text-[12px] font-light text-[var(--app-text-secondary)]">
            Ano
          </Label>
          <Input
            id="checkout-card-expiry-year"
            name="cc-exp-year"
            value={expiryYear}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="cc-exp-year"
            placeholder="AAAA"
            maxLength={4}
            className="mt-2 h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
            onChange={(event) => onExpiryYearChange(onlyDigits(event.target.value, 4))}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor="checkout-card-ccv" className="text-[12px] font-light text-[var(--app-text-secondary)]">
            Código de segurança
          </Label>
          <Input
            id="checkout-card-ccv"
            name="cc-csc"
            type="password"
            value={ccv}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="CVV"
            maxLength={4}
            className="mt-2 h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
            onChange={(event) => onCcvChange(onlyDigits(event.target.value, 4))}
          />
        </div>
      </div>

      <div
        id="card-security-note"
        className="flex items-start gap-2 rounded-[6px] bg-emerald-500/10 px-3 py-2.5 text-[11px] font-light leading-[17px] text-emerald-700 dark:text-emerald-300"
      >
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          O cartão é vinculado com segurança à assinatura para as próximas cobranças. A Vimob não grava o número nem o código de segurança.
        </span>
      </div>
    </div>
  );
}
