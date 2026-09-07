/** The owner, per ADMIN_TELEGRAM_ID. No admin configured — nobody qualifies. */
export const isAdmin = ({
  senderId,
  adminId,
}: {
  senderId: number | undefined;
  adminId: number | undefined;
}): boolean => adminId !== undefined && senderId === adminId;
