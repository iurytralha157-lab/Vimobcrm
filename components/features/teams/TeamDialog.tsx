import { useState, useEffect, useRef } from 'react';
import { Camera, Clock, Crown, Loader2, UserPlus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { useUsers } from '@/hooks/use-users';
import { useCreateTeam, useUpdateTeam, Team } from '@/hooks/use-teams';
import { teamsAPI } from '@/lib/api/teams';
import { toast } from 'sonner';
import { MemberAvailabilityDialog } from './MemberAvailabilityDialog';

interface TeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team?: Team | null;
  canEditLeadership?: boolean;
}

interface MemberSelection {
  userId: string;
  isLeader: boolean;
}

export function TeamDialog({ open, onOpenChange, team, canEditLeadership = true }: TeamDialogProps) {
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<MemberSelection[]>([]);
  const [availabilityMember, setAvailabilityMember] = useState<{
    id: string;
    name: string;
    avatar?: string | null;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: users = [] } = useUsers();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      if (team) {
        setName(team.name);
        setLogoUrl(team.logo_url || null);
        setSelectedMembers(
          team.members?.map((member) => ({
            userId: member.user_id,
            isLeader: member.is_leader || false,
          })) || []
        );
      } else {
        setName('');
        setLogoUrl(null);
        setSelectedMembers([]);
      }
      setLogoFile(null);
      setLogoPreview(null);
    });

    return () => {
      cancelled = true;
    };
  }, [team, open]);

  useEffect(() => {
    if (!logoFile) return;
    const url = URL.createObjectURL(logoFile);
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setLogoPreview(url);
    });

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [logoFile]);

  const getInitials = (value: string) =>
    value
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const isMemberSelected = (userId: string) => selectedMembers.some((member) => member.userId === userId);
  const getMemberSelection = (userId: string) => selectedMembers.find((member) => member.userId === userId);
  const getSavedTeamMember = (userId: string) => team?.members?.find((member) => member.user_id === userId);

  const toggleMember = (userId: string) => {
    const savedMember = getSavedTeamMember(userId);
    if (!canEditLeadership && savedMember?.is_leader) return;

    setSelectedMembers((prev) => {
      const exists = prev.find((member) => member.userId === userId);
      if (exists) return prev.filter((member) => member.userId !== userId);
      return [...prev, { userId, isLeader: false }];
    });
  };

  const toggleLeader = (userId: string) => {
    if (!canEditLeadership) return;
    setSelectedMembers((prev) =>
      prev.map((member) => (member.userId === userId ? { ...member, isLeader: !member.isLeader } : member))
    );
  };

  const uploadLogo = async () => {
    if (!logoFile) return logoUrl;

    const maxLogoSize = 5 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

    if (!allowedTypes.includes(logoFile.type)) {
      throw new Error('Tipo de imagem nao permitido. Use JPG, PNG, WEBP, GIF ou SVG.');
    }

    if (logoFile.size > maxLogoSize) {
      throw new Error('Imagem muito grande. O limite para logo da equipe e 5MB.');
    }

    return teamsAPI.uploadLogo(logoFile);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Informe o nome da equipe');
      return;
    }

    setIsSubmitting(true);

    try {
      const finalLogoUrl = await uploadLogo();
      const leadershipByUserId = new Map(
        (team?.members || []).map((member) => [member.user_id, member.is_leader || false])
      );
      const membersToSave = canEditLeadership
        ? selectedMembers
        : selectedMembers.map((member) => ({
            ...member,
            isLeader: leadershipByUserId.get(member.userId) ?? false,
          }));

      if (team) {
        await updateTeam.mutateAsync({
          id: team.id,
          name: name.trim(),
          logo_url: finalLogoUrl || null,
          is_active: team.is_active ?? true,
          members: membersToSave,
          preserveLeadership: !canEditLeadership,
        });
      } else {
        await createTeam.mutateAsync({
          name: name.trim(),
          logo_url: finalLogoUrl || null,
          is_active: true,
          members: membersToSave,
        });
      }

      onOpenChange(false);
    } catch (error) {
      console.error('Error saving team:', error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      toast.error(`Erro ao salvar equipe: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayLogo = logoPreview || logoUrl || undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-16px)] max-w-[560px] overflow-hidden border-0 bg-black/82 p-0 text-white shadow-2xl backdrop-blur-xl sm:rounded-[20px] [&>button]:hidden">
        <div className="flex max-h-[88vh] flex-col p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              <DialogTitle className="text-base font-semibold">{team ? 'Editar equipe' : 'Nova equipe'}</DialogTitle>
            </div>
            <button
              type="button"
              className="rounded-full p-1.5 text-white/65 transition hover:bg-white/10 hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col space-y-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/10 sm:h-14 sm:w-14"
                onClick={() => fileInputRef.current?.click()}
              >
                <Avatar className="h-full w-full">
                  <AvatarImage src={displayLogo} />
                  <AvatarFallback className="bg-primary/20 text-sm text-primary">
                    {getInitials(name || 'Equipe')}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                  <Camera className="h-4 w-4" />
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
              />
              <div className="min-w-0 flex-1">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nome da equipe"
                  className="h-10 rounded-xl border-0 bg-white/10 text-white placeholder:text-white/45 focus-visible:ring-primary"
                />
                <p className="mt-1.5 text-xs text-white/45">
                  {selectedMembers.length} {selectedMembers.length === 1 ? 'membro selecionado' : 'membros selecionados'}
                </p>
              </div>
            </div>

            <ScrollArea className="min-h-[220px] flex-1 pr-1 sm:pr-2">
              <div className="space-y-0.5 pb-1">
                {users.map((user) => {
                  const isSelected = isMemberSelected(user.id);
                  const memberData = getMemberSelection(user.id);
                  const savedMember = getSavedTeamMember(user.id);

                  return (
                    <div
                      key={user.id}
                      className={`flex min-w-0 items-center gap-1.5 rounded-xl px-2 py-1 transition sm:gap-2 sm:px-2.5 ${
                        isSelected ? 'bg-primary/14' : 'bg-white/8 hover:bg-white/12'
                      }`}
                    >
                      {/*
                        Team leaders can maintain members and schedules, but leadership
                        changes stay admin-only.
                      */}
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-75 sm:gap-2.5"
                        onClick={() => toggleMember(user.id)}
                        disabled={!canEditLeadership && !!savedMember?.is_leader}
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={user.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                            {getInitials(user.name || '?')}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1 max-[380px]:hidden">
                          <p className="truncate text-sm font-semibold">{user.name}</p>
                          <p className="truncate text-xs text-white/45">{user.email}</p>
                        </div>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition ${
                            isSelected ? 'bg-primary' : 'bg-white/12'
                          }`}
                        >
                          {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                      </button>

                      {isSelected && (
                        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-black/20 px-1.5 py-1 sm:gap-1.5 sm:px-2">
                          {savedMember && (
                            <button
                              type="button"
                              className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-primary"
                              title="Editar escala"
                              onClick={() =>
                                setAvailabilityMember({
                                  id: savedMember.id,
                                  name: user.name || 'Usuario',
                                  avatar: user.avatar_url,
                                })
                              }
                            >
                              <Clock className="h-4 w-4" />
                            </button>
                          )}
                          <div className="flex items-center gap-1.5 text-xs text-white/70">
                            <Crown className={`h-3.5 w-3.5 ${memberData?.isLeader ? 'text-amber-400' : 'text-white/35'}`} />
                            <span className="max-[440px]:hidden">Lider</span>
                          </div>
                          <Switch
                            checked={memberData?.isLeader || false}
                            onCheckedChange={() => toggleLeader(user.id)}
                            disabled={!canEditLeadership}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="mt-4 flex gap-3">
            <Button
              type="button"
              className="h-10 w-[30%] rounded-xl bg-white/10 text-white hover:bg-white/15"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-10 w-[70%] rounded-xl"
              onClick={handleSubmit}
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {team ? 'Salvar' : 'Criar equipe'}
            </Button>
          </div>
        </div>
      </DialogContent>
      {availabilityMember && (
        <MemberAvailabilityDialog
          open={!!availabilityMember}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setAvailabilityMember(null);
          }}
          teamMemberId={availabilityMember.id}
          memberName={availabilityMember.name}
          memberAvatar={availabilityMember.avatar}
        />
      )}
    </Dialog>
  );
}
