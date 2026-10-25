import { InputFile } from 'grammy';

import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { downloadPhoto } from '../photo-upload';

const SITE = 'idriver.by';
const PHOTO = 'https://img77.idriver.by/1.webp';
const MAX = 10 * 1024 * 1024;

const reply = (body: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'image/webp', ...headers } });

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

describe('downloadPhoto', () => {
  const fetchMock = undiciFetchMock();

  it('returns the bytes as a named file, typed by its extension, following no redirect itself', async () => {
    fetchMock.mockResolvedValueOnce(reply(new Uint8Array([1, 2, 3])));

    const file = await downloadPhoto(PHOTO, SITE);

    expect(file).toBeInstanceOf(InputFile);
    expect(file.filename).toBe('photo.webp');
    expect(fetchMock).toHaveBeenCalledWith(PHOTO, expect.objectContaining({ redirect: 'manual' }));
  });

  it('follows one redirect on the same site', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://img2.idriver.by/1.webp'))
      .mockResolvedValueOnce(reply(new Uint8Array([1])));

    await expect(downloadPhoto(PHOTO, SITE)).resolves.toBeInstanceOf(InputFile);
    expect(fetchMock).toHaveBeenLastCalledWith('https://img2.idriver.by/1.webp', expect.anything());
  });

  it('refuses a redirect off the site', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://evil.example/1.webp'));

    await expect(downloadPhoto(PHOTO, SITE)).rejects.toThrow('photo off idriver.by');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a second redirect', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://img2.idriver.by/1.webp'))
      .mockResolvedValueOnce(redirect('https://img3.idriver.by/1.webp'));

    await expect(downloadPhoto(PHOTO, SITE)).rejects.toThrow('photo HTTP 302');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a look-alike host', 'https://img77.evilidriver.by/1.webp'],
    ['another site', 'https://evil.example/1.webp'],
    ['plain http', 'http://img77.idriver.by/1.webp'],
    ['an explicit port', 'https://img77.idriver.by:8443/1.webp'],
  ])('refuses %s before any request', async (_, url) => {
    await expect(downloadPhoto(url, SITE)).rejects.toThrow('photo off idriver.by');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an error status, even with an image',
      reply(new Uint8Array([1]), { 'content-type': 'image/jpeg' }, 404),
    ],
    ['a page instead of an image', reply(new Uint8Array([1]), { 'content-type': 'text/html' })],
    ['a prototype key as the type', reply(new Uint8Array([1]), { 'content-type': 'constructor' })],
    ['a declared oversize', reply(new Uint8Array([1]), { 'content-length': String(MAX + 1) })],
    ['an empty body', reply(new Uint8Array([]))],
    ['an undeclared oversize', reply(new Uint8Array(MAX + 1))],
  ])('refuses %s', async (_, response) => {
    fetchMock.mockResolvedValueOnce(response);

    await expect(downloadPhoto(PHOTO, SITE)).rejects.toThrow(/^photo /);
  });
});
