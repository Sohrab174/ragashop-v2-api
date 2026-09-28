import { UserService } from './user.service';

describe('UserService.updateUser logging', () => {
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      spies.push(
        jest.spyOn(console, method).mockImplementation(() => undefined),
      );
    }
  });

  afterEach(() => {
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  it('applies the update without writing user, password or hash to logs', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const user: Record<string, unknown> = {
      id: 7,
      email: 'admin@example.test',
      password: '$2a$10$existing-bcrypt-hash',
      save,
    };
    const repo = { findOne: jest.fn().mockResolvedValue(user) };
    const service = new UserService(repo as any, {} as any, {} as any);

    await service.updateUser(7, {
      id: 99,
      firstName: 'New',
      password: 'Plaintext-New-Password-1',
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(user.id).toBe(7);
    expect(user.firstName).toBe('New');
    expect(user.password).toBe('Plaintext-New-Password-1');
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
