import { Logger } from '@nestjs/common';
import { GrammyError } from 'grammy';

import { makeListing } from '@/__tests__/helpers/listing';

import type { CardSender } from '../send-card';
import { MAX_PHOTOS_PER_CARD, SEND_DELAY_MS, listingMessage, sendCard } from '../send-card';

const logger = new Logger('test');

const stubSender = () => ({
  photo: jest.fn().mockResolvedValue(undefined),
  group: jest.fn().mockResolvedValue(undefined),
  html: jest.fn().mockResolvedValue(undefined),
  location: jest.fn().mockResolvedValue(undefined),
});

const photos = (n: number): string[] => Array.from({ length: n }, (_, i) => `https://cdn/${i}.jpg`);

const send = (sender: CardSender, images: string[], rest = {}): Promise<void> =>
  sendCard(sender, { caption: 'card', images, ...rest }, logger);

describe('sendCard', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.useRealTimers());

  /** The extra requests a card can make — the fallback and the pin — are paced like any other. */
  const settlePaced = async (run: Promise<void>): Promise<void> => {
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS);
    await run;
  };

  it('sends a lone photo with the card as its caption', async () => {
    const sender = stubSender();

    await send(sender, photos(1));

    expect(sender.photo).toHaveBeenCalledWith('https://cdn/0.jpg', 'card');
  });

  it('puts the caption on the first item of a group — Telegram ignores the others', async () => {
    const sender = stubSender();

    await send(sender, photos(3));

    const [media] = sender.group.mock.calls[0] as [Array<{ caption?: string; media: string }>];
    expect(media).toHaveLength(3);
    expect(media[0]).toMatchObject({ media: 'https://cdn/0.jpg', caption: 'card' });
    expect(media.slice(1).every((item) => item.caption === undefined)).toBe(true);
  });

  it('caps a group at the limit Telegram accepts', async () => {
    const sender = stubSender();

    await send(sender, photos(MAX_PHOTOS_PER_CARD + 5));

    const [media] = sender.group.mock.calls[0] as [unknown[]];
    expect(media).toHaveLength(MAX_PHOTOS_PER_CARD);
  });

  it('sends a card without photos as a message of its own', async () => {
    const sender = stubSender();

    await send(sender, []);

    expect(sender.html).toHaveBeenCalledWith('card');
    expect(sender.photo).not.toHaveBeenCalled();
  });

  // The listing matters more than its pictures, and only what arrives is marked seen.
  it('falls back to the text card when the media is refused', async () => {
    jest.useFakeTimers();
    const sender = stubSender();
    sender.photo.mockRejectedValue(new Error('WEBPAGE_MEDIA_EMPTY'));

    await settlePaced(send(sender, photos(1)));

    expect(sender.html).toHaveBeenCalledWith('card');
  });

  it('counts a fallback, so a systematic media failure is visible outside the log', async () => {
    jest.useFakeTimers();
    const sender = stubSender();
    sender.photo.mockRejectedValue(new Error('WEBPAGE_MEDIA_EMPTY'));
    const onPhotoFallback = jest.fn();

    await settlePaced(
      sendCard(sender, { caption: 'card', images: photos(1) }, logger, onPhotoFallback),
    );

    expect(onPhotoFallback).toHaveBeenCalledTimes(1);
  });

  it('gives up when the chat itself is blocked — the text would be refused too', async () => {
    const sender = stubSender();
    const blocked = new GrammyError(
      'Forbidden: bot was blocked by the user',
      { ok: false, error_code: 403, description: 'blocked' },
      'sendPhoto',
      {},
    );
    sender.photo.mockRejectedValue(blocked);

    await expect(send(sender, photos(1))).rejects.toBe(blocked);
    expect(sender.html).not.toHaveBeenCalled();
  });

  it('drops the pin after the card, and a failed pin is not a failed delivery', async () => {
    jest.useFakeTimers();
    const sender = stubSender();
    sender.location.mockRejectedValue(new Error('nope'));

    const run = send(sender, photos(1), { coordinates: { lat: 53.68, lon: 23.85 } });

    await expect(settlePaced(run)).resolves.toBeUndefined();
    expect(sender.location).toHaveBeenCalledWith({ lat: 53.68, lon: 23.85 });
  });

  // The pin is one more request to the same chat, so it waits its turn like the rest.
  it('paces the pin behind the card', async () => {
    jest.useFakeTimers();
    const sender = stubSender();

    const run = send(sender, photos(1), { coordinates: { lat: 53.68, lon: 23.85 } });
    await Promise.resolve();
    expect(sender.location).not.toHaveBeenCalled();

    await settlePaced(run);

    expect(sender.location).toHaveBeenCalled();
  });

  it('sends no pin when the source published none — realt never does', async () => {
    const sender = stubSender();

    await send(sender, photos(1));

    expect(sender.location).not.toHaveBeenCalled();
  });
});

describe('listingMessage', () => {
  const long = 'я'.repeat(3000);

  it('builds the card against the caption limit when photos will carry it', () => {
    const message = listingMessage(
      makeListing(1, { description: long, images: ['https://cdn/0.jpg'] }),
    );

    expect(message.caption.length).toBeLessThanOrEqual(1024);
  });

  it('uses the full message limit when the card goes out alone', () => {
    const message = listingMessage(makeListing(1, { description: long }));

    expect(message.caption.length).toBeGreaterThan(1024);
    expect(message.caption.length).toBeLessThanOrEqual(4096);
  });

  it('numbers a card inside a run, and leaves a lone card unnumbered', () => {
    expect(listingMessage(makeListing(1), { index: 2, total: 5 }).caption).toContain('🆕 2/5');
    expect(listingMessage(makeListing(1), { index: 1, total: 1 }).caption).not.toContain('🆕');
  });
});
