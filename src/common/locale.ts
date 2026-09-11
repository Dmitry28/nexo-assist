/**
 * The audience is Belarusian (PRODUCT.md § Status now), so user-facing dates and numbers are
 * formatted for it — and pinned here rather than left to the host: a pod runs on UTC, and
 * «сегодня 14:30» computed in UTC is wrong for three hours of every day.
 */
export const LOCALE = 'ru-RU';
export const TIMEZONE = 'Europe/Minsk';
