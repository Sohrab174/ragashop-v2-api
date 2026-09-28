import {
  AmootsmsService,
  isAmootSuccessResponse,
} from './amootsms/amootsms.service';
import { VatansmsService } from './vatansms/vatansms.service';

const fakeConfig = {
  sms: {
    amootsmsUsername: 'fake-amoot-user',
    amootsmsPassword: 'fake-amoot-pass',
    vatansmsApiId: 'fake-vatan-id',
    vatansmsApiKey: 'fake-vatan-key',
  },
};

function expectNoSecretsLogged(spy: jest.SpyInstance) {
  const logged = JSON.stringify(spy.mock.calls);
  for (const secret of Object.values(fakeConfig.sms)) {
    expect(logged).not.toContain(secret);
  }
  expect(logged).not.toContain('54321');
}

describe('isAmootSuccessResponse', () => {
  it.each([
    [{ Status: 'Success' }],
    [{ status: 'success' }],
    ['{"Status":"Success","Data":[]}'],
  ])('accepts %j', (body) => {
    expect(isAmootSuccessResponse(body)).toBe(true);
  });

  it.each([
    [{ Status: 'Error', Message: 'invalid credentials' }],
    [{ Status: 'Failed' }],
    [{}],
    [null],
    [''],
    ['not json'],
    [1],
  ])('rejects %j', (body) => {
    expect(isAmootSuccessResponse(body)).toBe(false);
  });
});

describe('AmootsmsService.sendOTP', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  function makeService(get: jest.Mock) {
    const service = new AmootsmsService(fakeConfig as any);
    (service as any).axios = { get };
    return service;
  }

  it('returns true when the provider confirms', async () => {
    const service = makeService(
      jest.fn().mockResolvedValue({ data: { Status: 'Success' } }),
    );
    await expect(service.sendOTP('+989121234567', '54321')).resolves.toBe(true);
  });

  it('returns false on a provider error status without logging secrets', async () => {
    const service = makeService(
      jest.fn().mockResolvedValue({ data: { Status: 'Error' } }),
    );
    await expect(service.sendOTP('+989121234567', '54321')).resolves.toBe(
      false,
    );
    expectNoSecretsLogged(errorSpy);
  });

  it('returns false on a network failure without logging secrets', async () => {
    const failure = Object.assign(new Error('timeout'), {
      config: { params: fakeConfig.sms },
    });
    const service = makeService(jest.fn().mockRejectedValue(failure));
    await expect(service.sendOTP('+989121234567', '54321')).resolves.toBe(
      false,
    );
    expectNoSecretsLogged(errorSpy);
  });
});

describe('VatansmsService.sendOTP', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  function makeService(post: jest.Mock) {
    const service = new VatansmsService(fakeConfig as any);
    (service as any).axios = { post };
    return service;
  }

  it('returns true when the provider reports success', async () => {
    const service = makeService(
      jest.fn().mockResolvedValue({ data: { status: 'success' } }),
    );
    await expect(service.sendOTP('+905321234567', '54321')).resolves.toBe(true);
  });

  it('returns false on a provider error status', async () => {
    const service = makeService(
      jest.fn().mockResolvedValue({ data: { status: 'error' } }),
    );
    await expect(service.sendOTP('+905321234567', '54321')).resolves.toBe(
      false,
    );
    expectNoSecretsLogged(errorSpy);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('5321234567');
  });

  it('returns false on a network failure', async () => {
    const service = makeService(jest.fn().mockRejectedValue(new Error('x')));
    await expect(service.sendOTP('+905321234567', '54321')).resolves.toBe(
      false,
    );
    expectNoSecretsLogged(errorSpy);
  });
});
