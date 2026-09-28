type AttendanceForSend = {
  joined: boolean;
  canSend?: boolean;
};

export function getWhatsAppAttendanceGateDecision(
  attendance: AttendanceForSend,
): 'send' | 'confirm' | 'blocked' {
  if (attendance.canSend === false) return 'blocked';
  return attendance.joined ? 'send' : 'confirm';
}
