import { isAdmin } from '../admin';

describe('isAdmin', () => {
  it('grants only the configured owner', () => {
    expect(isAdmin({ senderId: 99, adminId: 99 })).toBe(true);
    expect(isAdmin({ senderId: 1, adminId: 99 })).toBe(false);
  });

  // Without the adminId guard both sides are `undefined` and compare equal, so a sender-less
  // update (a channel post) would pass as the owner and /stats would answer it.
  it('grants nobody when no admin is configured', () => {
    expect(isAdmin({ senderId: undefined, adminId: undefined })).toBe(false);
    expect(isAdmin({ senderId: 5, adminId: undefined })).toBe(false);
  });
});
