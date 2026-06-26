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
  role?: string;
}

interface BrokerSelectorProps {
  brokers: BrokerEntry[];
  onChange: (brokers: BrokerEntry[]) => void;
}

export function BrokerSelector({ brokers, onChange }: BrokerSelectorProps) {
  const { data: users } = useUsers();

  const addBroker = () => {
    onChange([...brokers, { user_id: '', commission_percentage: 0, role: 'broker' }]);
  };

  const removeBroker = (index: number) => {
    onChange(brokers.filter((_, i) => i !== index));
  };

  const updateBroker = (index: number, field: keyof BrokerEntry, value: string | number) => {
    const updated = [...brokers];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const totalPercentage = brokers.reduce((sum, b) => sum + (b.commission_percentage || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Corretores Participantes</Label>
        <Button type="button" variant="outline" size="sm" onClick={addBroker}>
          <Plus className="h-4 w-4 mr-1" />
          Adicionar
        </Button>
      </div>

      {brokers.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nenhum corretor adicionado
        </p>
      )}

      <div className="space-y-3">
        {brokers.map((broker, index) => (
          <div key={index} className="flex items-end gap-3 p-3 bg-white/[0.045] rounded-lg">
            <div className="flex-1 space-y-2">
              <Label className="text-xs">Corretor</Label>
              <Select
                value={broker.user_id}
                onValueChange={(value) => updateBroker(index, 'user_id', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {users?.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-24 space-y-2">
              <Label className="text-xs">Comissão %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={broker.commission_percentage}
                onChange={(e) => updateBroker(index, 'commission_percentage', parseFloat(e.target.value) || 0)}
              />
            </div>

            <div className="w-28 space-y-2">
              <Label className="text-xs">Papel</Label>
              <Select
                value={broker.role || 'broker'}
                onValueChange={(value) => updateBroker(index, 'role', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="broker">Corretor</SelectItem>
                  <SelectItem value="captador">Captador</SelectItem>
                  <SelectItem value="closer">Closer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => removeBroker(index)}
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
    </div>
  );
}
