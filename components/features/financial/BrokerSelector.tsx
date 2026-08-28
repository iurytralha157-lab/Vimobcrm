import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUsers } from '@/hooks/use-users';
import { Plus, Trash2 } from 'lucide-react';

export interface BrokerEntry {
  user_id: string;
  commission_percentage: number;
}

interface BrokerSelectorProps {
  brokers: BrokerEntry[];
  onChange: (brokers: BrokerEntry[]) => void;
  disabled?: boolean;
  error?: string;
}

export function BrokerSelector({
  brokers,
  onChange,
  disabled = false,
  error,
}: BrokerSelectorProps) {
  const {
    data: users,
    isLoading: usersLoading,
    error: usersError,
    refetch: refetchUsers,
  } = useUsers();

  const addBroker = () => {
    onChange([...brokers, { user_id: '', commission_percentage: 0 }]);
  };

  const removeBroker = (index: number) => {
    onChange(brokers.filter((_, i) => i !== index));
  };

  const updateBroker = <K extends keyof BrokerEntry>(
    index: number,
    field: K,
    value: BrokerEntry[K],
  ) => {
    const updated = [...brokers];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const totalPercentage = brokers.reduce((sum, b) => sum + (b.commission_percentage || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Corretores participantes</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addBroker}
          disabled={disabled || usersLoading || Boolean(usersError)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Adicionar
        </Button>
      </div>

      {brokers.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nenhum corretor adicionado
        </p>
      )}

      {usersError && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"
          role="alert"
        >
          <span>Não foi possível carregar os usuários.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetchUsers()}
            disabled={disabled}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {brokers.map((broker, index) => (
          <div
            key={`${broker.user_id || 'novo'}-${index}`}
            className="grid grid-cols-1 gap-3 rounded-lg bg-muted/45 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
          >
            <div className="min-w-0 space-y-2">
              <Label className="text-xs" htmlFor={`broker-user-${index}`}>Corretor</Label>
              <Select
                value={broker.user_id}
                disabled={disabled || usersLoading || Boolean(usersError)}
                onValueChange={(value) => updateBroker(index, 'user_id', value)}
              >
                <SelectTrigger id={`broker-user-${index}`}>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {users?.map((user) => (
                    <SelectItem
                      key={user.id}
                      value={user.id}
                      disabled={brokers.some(
                        (candidate, candidateIndex) =>
                          candidateIndex !== index && candidate.user_id === user.id,
                      )}
                    >
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs" htmlFor={`broker-percentage-${index}`}>Comissão %</Label>
              <Input
                id={`broker-percentage-${index}`}
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={broker.commission_percentage}
                disabled={disabled}
                onChange={(e) => updateBroker(index, 'commission_percentage', parseFloat(e.target.value) || 0)}
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => removeBroker(index)}
              disabled={disabled}
              aria-label={`Remover corretor ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {brokers.length > 0 && (
        <div className={`text-sm font-medium text-right ${totalPercentage > 100 ? 'text-destructive' : 'text-muted-foreground'}`}>
          Total: {totalPercentage}%
          {totalPercentage > 100 && ' (excede 100%)'}
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
