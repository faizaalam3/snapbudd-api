import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import type { FirebaseService } from '../../firebase/firebase.service';
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));
function setup(
  authError?: unknown,
  dbError?: unknown,
  status = 'active',
  merchantId = 'shop',
) {
  const request = { headers: { authorization: 'Bearer example-token' } };
  const get = jest.fn(async () => {
    if (dbError) throw dbError;
    return { data: () => ({ merchantId, status }) };
  });
  const verifyIdToken = jest.fn(async () => {
    if (authError) throw authError;
    return { uid: 'owner' };
  });
  const guard = new FirebaseAuthGuard({
    auth: { verifyIdToken },
    db: { collection: () => ({ doc: () => ({ get }) }) },
  } as unknown as FirebaseService);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, context, request, get };
}
describe('Firebase portal authentication', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterAll(() => jest.restoreAllMocks());
  it('allows a verified sign-in with active merchant membership', async () => {
    const f = setup();
    await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    expect(f.request).toHaveProperty('firebaseUser', {
      uid: 'owner',
      merchantId: 'shop',
    });
  });
  it('rejects expired tokens as authentication failures', async () => {
    const f = setup({ code: 'auth/id-token-expired' });
    await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(f.get).not.toHaveBeenCalled();
  });
  it('reports Firebase infrastructure failures separately from bad tokens', async () => {
    const f = setup({ code: 'app/invalid-credential' });
    await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('does not misreport Firestore failures as expired tokens', async () => {
    const f = setup(undefined, { code: 7 });
    await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('denies inactive or unlinked merchant memberships', async () => {
    for (const f of [
      setup(undefined, undefined, 'inactive'),
      setup(undefined, undefined, 'active', ''),
    ])
      await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
  });
});
