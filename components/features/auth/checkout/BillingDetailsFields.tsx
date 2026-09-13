import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type BillingDetailsFieldsProps = {
  name: string;
  email: string;
  document: string;
  phone: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onDocumentChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onPostalCodeChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onAddressNumberChange: (value: string) => void;
  onAddressComplementChange: (value: string) => void;
  onNeighborhoodChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onStateChange: (value: string) => void;
};

const INPUT_CLASS_NAME =
  "h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 py-0 !text-[12px] font-light text-[var(--app-text-secondary)] shadow-none placeholder:text-[var(--app-text-secondary)] placeholder:opacity-100 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0";

export function BillingDetailsFields({
  name,
  email,
  document,
  phone,
  postalCode,
  address,
  addressNumber,
  addressComplement,
  neighborhood,
  city,
  state,
  disabled,
  onNameChange,
  onEmailChange,
  onDocumentChange,
  onPhoneChange,
  onPostalCodeChange,
  onAddressChange,
  onAddressNumberChange,
  onAddressComplementChange,
  onNeighborhoodChange,
  onCityChange,
  onStateChange,
}: BillingDetailsFieldsProps) {
  const labelClassName = "sr-only";

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-6">
      <div className="sm:col-span-3">
        <Label htmlFor="billing-holder-name" className={labelClassName}>
          Nome ou razão social
        </Label>
        <Input
          id="billing-holder-name"
          autoComplete="name"
          required
          minLength={2}
          placeholder="Nome ou razão social"
          value={name}
          disabled={disabled}
          onChange={(event) => onNameChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-email" className={labelClassName}>
          E-mail
        </Label>
        <Input
          id="billing-email"
          type="email"
          autoComplete="email"
          required
          placeholder="E-mail"
          value={email}
          disabled={disabled}
          onChange={(event) => onEmailChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-document" className={labelClassName}>
          CPF/CNPJ
        </Label>
        <Input
          id="billing-document"
          inputMode="numeric"
          required
          pattern="[0-9.\/-]{11,18}"
          title="Informe um CPF ou CNPJ com 11 ou 14 números."
          placeholder="CPF/CNPJ"
          value={document}
          disabled={disabled}
          onChange={(event) => onDocumentChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-phone" className={labelClassName}>
          Celular
        </Label>
        <Input
          id="billing-phone"
          type="tel"
          autoComplete="tel"
          required
          placeholder="Celular"
          value={phone}
          disabled={disabled}
          onChange={(event) => onPhoneChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-country" className={labelClassName}>
          País de residência
        </Label>
        <Input
          id="billing-country"
          placeholder="País de residência"
          value="Brasil"
          readOnly
          disabled={disabled}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-postal-code" className={labelClassName}>
          CEP
        </Label>
        <Input
          id="billing-postal-code"
          inputMode="numeric"
          autoComplete="postal-code"
          required
          pattern="[0-9-]{8,9}"
          title="Informe um CEP com 8 números."
          placeholder="CEP"
          value={postalCode}
          disabled={disabled}
          onChange={(event) => onPostalCodeChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-4">
        <Label htmlFor="billing-address" className={labelClassName}>
          Endereço
        </Label>
        <Input
          id="billing-address"
          autoComplete="street-address"
          required
          minLength={3}
          placeholder="Endereço"
          value={address}
          disabled={disabled}
          onChange={(event) => onAddressChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="billing-address-number" className={labelClassName}>
          Número
        </Label>
        <Input
          id="billing-address-number"
          autoComplete="address-line2"
          required
          placeholder="Número"
          value={addressNumber}
          disabled={disabled}
          onChange={(event) => onAddressNumberChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-address-complement" className={labelClassName}>
          Complemento{" "}
          <span className="text-[var(--app-text-tertiary)]">(opcional)</span>
        </Label>
        <Input
          id="billing-address-complement"
          placeholder="Complemento (opcional)"
          value={addressComplement}
          disabled={disabled}
          onChange={(event) => onAddressComplementChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-neighborhood" className={labelClassName}>
          Bairro
        </Label>
        <Input
          id="billing-neighborhood"
          required
          placeholder="Bairro"
          value={neighborhood}
          disabled={disabled}
          onChange={(event) => onNeighborhoodChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-4">
        <Label htmlFor="billing-city" className={labelClassName}>
          Cidade
        </Label>
        <Input
          id="billing-city"
          autoComplete="address-level2"
          required
          placeholder="Cidade"
          value={city}
          disabled={disabled}
          onChange={(event) => onCityChange(event.target.value)}
          className={INPUT_CLASS_NAME}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="billing-state" className={labelClassName}>
          UF
        </Label>
        <Input
          id="billing-state"
          autoComplete="address-level1"
          required
          minLength={2}
          maxLength={2}
          placeholder="UF"
          value={state}
          disabled={disabled}
          onChange={(event) => onStateChange(event.target.value.toUpperCase())}
          className={INPUT_CLASS_NAME}
        />
      </div>
    </div>
  );
}
