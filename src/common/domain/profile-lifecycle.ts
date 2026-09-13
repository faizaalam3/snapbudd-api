export type ProfileStatus =
  'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';

const transitions: Record<ProfileStatus, ReadonlySet<ProfileStatus>> = {
  draft: new Set(['draft', 'pending']),
  pending: new Set(['pending', 'approved', 'rejected']),
  approved: new Set(['approved', 'suspended']),
  rejected: new Set(['rejected', 'pending']),
  suspended: new Set(['suspended', 'approved']),
};

export function normalizeProfileStatus(value: unknown): ProfileStatus {
  const status = String(value ?? 'draft')
    .trim()
    .toLowerCase();
  return status in transitions ? (status as ProfileStatus) : 'draft';
}

export function canTransitionProfile(from: unknown, to: unknown): boolean {
  return transitions[normalizeProfileStatus(from)].has(
    normalizeProfileStatus(to),
  );
}

export function profileDetailsEditable(status: unknown): boolean {
  return ['draft', 'pending', 'rejected'].includes(
    normalizeProfileStatus(status),
  );
}

export function assertApprovedProfile(
  profile: Record<string, unknown>,
  label: string,
): void {
  if (normalizeProfileStatus(profile.status) !== 'approved') {
    throw new Error(
      `${label} must be approved before using operational features`,
    );
  }
}
