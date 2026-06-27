import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Shuffle, Loader2, Trash2, Save } from 'lucide-react';
import {
  RoundRobin,
  RoundRobinMember,
  useUpdateRoundRobinMembers,
  useAddRoundRobinMember,
  useRemoveRoundRobinMember
} from '@/hooks/use-round-robins';
import { useOrganizationUsers } from '@/hooks/use-users';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface EditQueueDialogProps {
  queue: RoundRobin | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditQueueDialog({ queue, open, onOpenChange }: EditQueueDialogProps) {
  const { data: users = [] } = useOrganizationUsers();
  const updateMembers = useUpdateRoundRobinMembers();
  const addMember = useAddRoundRobinMember();
  const removeMember = useRemoveRoundRobinMember();

  const [localMembers, setLocalMembers] = useState<(RoundRobinMember & { weight: number })[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [resetCounter, setResetCounter] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!queue) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setLocalMembers(queue.members.map(m => ({
        ...m,
        weight: m.weight || 10,
      })));
      setHasChanges(false);
    });

    return () => {
      cancelled = true;
    };
  }, [queue]);

  if (!queue) return null;

  // Calculate total weight for percentage display
  const totalWeight = localMembers.reduce((sum, m) => sum + m.weight, 0);

  const handleWeightChange = (memberId: string, value: number) => {
    setLocalMembers(prev =>
      prev.map(m => m.id === memberId ? { ...m, weight: Math.max(1, value) } : m)
    );
    setHasChanges(true);
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;

    await addMember.mutateAsync({
      roundRobinId: queue.id,
      userId: selectedUserId,
      weight: 10,
    });

    setSelectedUserId('');
  };

  const handleRemoveMember = async (memberId: string) => {
    await removeMember.mutateAsync(memberId);
  };

  const handleSave = async () => {
    await updateMembers.mutateAsync({
      roundRobinId: queue.id,
      members: localMembers.map(m => ({
        memberId: m.id,
        weight: m.weight,
      })),
    });

    setHasChanges(false);
    onOpenChange(false);
  };

  // Filter out users already in the queue
  const availableUsers = users.filter(
    u => !localMembers.some(m => m.user_id === u.id)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shuffle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>{queue.name}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configure a distribuição automática de leads
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Info text */}
          <div className="rounded-lg bg-[var(--app-surface-soft)] p-3 text-sm text-[var(--app-text-secondary)]">
            A distribuição será automática para todos os leads que entrarem nesta fila.
            Ajuste o percentual de cada usuário para determinar a proporção de leads que ele receberá.
          </div>

          {/* Members Table */}
          <div className="overflow-hidden rounded-lg border-0 bg-[var(--app-surface)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[45%]">Usuários</TableHead>
                  <TableHead className="w-[25%] text-center">Percentual %</TableHead>
                  <TableHead className="w-[20%] text-center">Contador</TableHead>
                  <TableHead className="w-[10%]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localMembers.map((member) => {
                  const percentage = totalWeight > 0
                    ? Math.round((member.weight / totalWeight) * 100)
                    : 0;

                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{member.user?.name || 'Usuário'}</span>
                          {member.user?.email && (
                            <span className="text-xs text-muted-foreground">
                              {member.user.email}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-2">
                          <Input
                            type="number"
                            value={member.weight}
                            onChange={(e) => handleWeightChange(member.id, parseInt(e.target.value) || 1)}
                            className="w-16 text-center"
                            min={1}
                            max={100}
                          />
                          <span className="text-sm text-muted-foreground w-10">
                            ({percentage}%)
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-muted-foreground">
                          {member.leads_count || 0}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={removeMember.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {localMembers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Nenhum usuário na fila. Adicione usuários abaixo.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Add member */}
          <div className="flex gap-2">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Adicione um usuário..." />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map(user => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} {user.email && `<${user.email}>`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleAddMember}
              disabled={!selectedUserId || addMember.isPending}
            >
              {addMember.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Adicionar'
              )}
            </Button>
          </div>

          {/* Reset counter option */}
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="reset-counter"
              checked={resetCounter}
              onCheckedChange={(checked) => setResetCounter(checked as boolean)}
            />
            <Label htmlFor="reset-counter" className="text-sm text-muted-foreground cursor-pointer">
              Ao salvar, a contagem de leads será reiniciada.
            </Label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMembers.isPending || !hasChanges}
            >
              {updateMembers.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
