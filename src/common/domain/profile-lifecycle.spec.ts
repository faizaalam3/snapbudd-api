import {
  canTransitionProfile,
  normalizeProfileStatus,
  profileDetailsEditable,
} from './profile-lifecycle';

describe('profile lifecycle', () => {
  it('allows applicants to correct drafts, pending and rejected profiles', () => {
    expect(profileDetailsEditable('draft')).toBe(true);
    expect(profileDetailsEditable('pending')).toBe(true);
    expect(profileDetailsEditable('rejected')).toBe(true);
  });

  it('locks identity details after approval or suspension', () => {
    expect(profileDetailsEditable('approved')).toBe(false);
    expect(profileDetailsEditable('suspended')).toBe(false);
  });

  it('uses explicit moderation transitions', () => {
    expect(canTransitionProfile('pending', 'approved')).toBe(true);
    expect(canTransitionProfile('approved', 'draft')).toBe(false);
    expect(canTransitionProfile('suspended', 'approved')).toBe(true);
  });

  it('normalizes unknown legacy values safely to draft', () => {
    expect(normalizeProfileStatus('READY')).toBe('draft');
  });
});
