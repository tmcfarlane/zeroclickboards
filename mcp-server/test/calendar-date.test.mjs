import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { formatCalendarDate, normalizeCalendarDate, parseCalendarDate } from '../dist/calendar-date.js';

test('calendar dates preserve real Gregorian days, early years, and years beyond 9999', () => {
  for (const value of ['0001-01-01', '0004-02-29', '0099-12-31', '0100-01-31', '0400-02-29', '2000-02-29', '2024-02-29', '2026-03-08', '2026-11-01', '10000-01-01', '275760-09-12']) {
    assert.equal(normalizeCalendarDate(value), value);
    const date = parseCalendarDate(value);
    assert.equal(date.getFullYear(), Number(value.split('-')[0]));
    assert.equal(date.getHours(), 0);
    assert.equal(formatCalendarDate(date), value);
  }
  assert.equal(normalizeCalendarDate('000001-01-01'), '0001-01-01');
});

test('valid ISO timestamps normalize to their written date without offset conversion', () => {
  for (const suffix of ['T00:00', 'T12:30:45', 'T23:59:59.123456789', 'T00:00Z', 'T23:59:59.1Z', 'T00:00+14:00', 'T23:30:00-08:00', 'T12:30+0530', 't12:30:00z']) {
    assert.equal(normalizeCalendarDate(`2026-04-15${suffix}`), '2026-04-15', suffix);
  }
  assert.equal(normalizeCalendarDate('0099-12-31T23:30:00-08:00'), '0099-12-31');
});

test('malformed dates, rollover dates, invalid timestamps, and out-of-range years are rejected', () => {
  for (const value of [
    '', ' ', 'not-a-date', '2026-04-15garbage', ' 2026-04-15', '2026-04-15 ', '2026-04-15\n',
    '2026-1-01', '2026-01-1', '01/02/2026', '100-01-01', '0000-01-01', '-000001-01-01',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-04-31', '2026-02-29', '2026-02-31', '1900-02-29', '0100-02-29',
    '2026-04-15T', '2026-04-15T1:00', '2026-04-15T24:00', '2026-04-15T12:60', '2026-04-15T12:00:60',
    '2026-04-15T12:30.5', '2026-04-15T12:30:00.', '2026-04-15T12:30:00Zgarbage',
    '2026-04-15T12:30+24:00', '2026-04-15T12:30+01:60', '2026-04-15T12:30+01', '2026-02-31T12:30Z',
    '275760-09-14', '99999999999999999999-01-01',
  ]) {
    assert.equal(normalizeCalendarDate(value), undefined, value);
    assert.equal(Number.isNaN(parseCalendarDate(value).getTime()), true, value);
  }
});

test('formatting rejects invalid or nonpositive years without changing the input', () => {
  assert.equal(formatCalendarDate(new Date(NaN)), undefined);
  const zero = new Date(0);
  zero.setFullYear(0, 1, 1);
  assert.equal(formatCalendarDate(zero), undefined);
  const date = parseCalendarDate('0099-12-31');
  date.setHours(17, 42);
  const before = date.getTime();
  assert.equal(formatCalendarDate(date), '0099-12-31');
  assert.equal(date.getTime(), before);
});

test('calendar dates and timestamp prefixes remain stable across UTC, DST, and positive offsets', () => {
  const moduleUrl = new URL('../dist/calendar-date.js', import.meta.url).href;
  const source = `import {normalizeCalendarDate, parseCalendarDate} from ${JSON.stringify(moduleUrl)};
    const values = ['2026-03-08', '2026-11-01', '2026-04-15T23:30:00-08:00', '2026-04-15T00:30:00+14:00', '0099-12-31'];
    console.log(JSON.stringify(values.map(value => [normalizeCalendarDate(value), parseCalendarDate(value).getHours()])));`;
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata']) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), [['2026-03-08', 0], ['2026-11-01', 0], ['2026-04-15', 0], ['2026-04-15', 0], ['0099-12-31', 0]], TZ);
  }
});
