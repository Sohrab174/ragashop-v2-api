import { TelegrafBotService } from './telegraf-bot.service';
import { maskMobileForOps } from './telegram-privacy';

describe('TelegrafBotService.sendNotification', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('is a no-op when no bot is configured', async () => {
    const service = new TelegrafBotService(undefined);
    await expect(
      service.sendNotification('hello', [1]),
    ).resolves.toBeUndefined();
  });

  it('never rejects and keeps delivering to other recipients', async () => {
    const sendMessage = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Forbidden: bot was blocked'), {
          response: { error_code: 403 },
          on: { payload: { chat_id: 1, text: 'secret body' } },
        }),
      )
      .mockResolvedValueOnce({});
    const service = new TelegrafBotService({
      telegram: { sendMessage },
    } as any);

    await expect(
      service.sendNotification('secret body', [1, 2]),
    ).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(2);

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('403');
    expect(logged).not.toContain('secret body');
  });

  it('never rejects when sendMessage throws synchronously', async () => {
    const sendMessage = jest.fn(() => {
      throw new Error('sync failure');
    });
    const service = new TelegrafBotService({
      telegram: { sendMessage },
    } as any);
    await expect(service.sendNotification('x', [1])).resolves.toBeUndefined();
  });
});

describe('maskMobileForOps', () => {
  it.each([
    ['+989121234567', '***4567'],
    ['+905321234567', '***4567'],
    ['09121234567', '***4567'],
    ['123', '****'],
    ['', '****'],
    [null, '—'],
    [undefined, '—'],
  ])('%j → %j', (input, expected) => {
    expect(maskMobileForOps(input as string)).toBe(expected);
  });

  it('never reveals more than the last four digits', () => {
    const masked = maskMobileForOps('+989121234567');
    expect(masked).not.toContain('912123');
    expect(masked.replace(/\D/g, '')).toHaveLength(4);
  });
});
