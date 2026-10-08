import { describe, expect, it } from 'vitest';

import type { Section } from '../../src/interpret/sections.js';

import { checkServerAddress, describeConnectionError } from './address.js';
import { rememberAccount, statementKey, suggestAccount } from './mapping.js';
import { versionsMatch } from './session.js';

describe('checkServerAddress', () => {
  it('accepts an https address and tidies it', () => {
    expect(checkServerAddress(' https://actual.example.test/ ')).toEqual({
      url: 'https://actual.example.test',
    });
    expect(checkServerAddress('actual.example.test')).toEqual({
      url: 'https://actual.example.test',
    });
  });

  it('accepts http only on this computer', () => {
    expect(checkServerAddress('http://localhost:5006')).toEqual({
      url: 'http://localhost:5006',
    });
    expect(checkServerAddress('http://127.0.0.1:5006').url).toBe('http://127.0.0.1:5006');
  });

  it('explains why a plain http address elsewhere is refused', () => {
    expect(checkServerAddress('http://192.168.1.20:5006').problem).toContain('https');
    expect(checkServerAddress('ftp://example.test').problem).toBeDefined();
    expect(checkServerAddress('').problem).toContain('Enter');
  });
});

describe('describeConnectionError', () => {
  it('turns API errors into sentences', () => {
    expect(describeConnectionError(new Error('Authentication failed: invalid-password'))).toContain(
      'did not accept',
    );
    expect(describeConnectionError(new TypeError('Failed to fetch'))).toContain('Could not reach');
    expect(describeConnectionError(new Error('Could not get remote files'))).toContain('Sync ID');
    expect(describeConnectionError(new Error('something unexpected'))).toBe('something unexpected');
    expect(describeConnectionError({ reason: 'invalid-password' })).toContain('did not accept');
    expect(describeConnectionError({ message: 'Failed to fetch' })).toContain('Could not reach');
  });
});

describe('versionsMatch', () => {
  it('compares year and month only, and trusts an unknown server', () => {
    expect(versionsMatch('26.10.0', '26.10.3')).toBe(true);
    expect(versionsMatch('26.10.0', '26.9.0')).toBe(false);
    expect(versionsMatch('26.10.0', null)).toBe(true);
  });
});

describe('remembering which Actual account a statement account goes to', () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  const section = { account: '1234' } as Section;
  const accounts = [
    { id: 'a1', name: 'Acme Savings' },
    { id: 'a2', name: 'Acme Savings 1234' },
  ];

  it('uses the last choice, then the name that carries the digits, then nothing', () => {
    const storage = store();
    const key = statementKey('sync-1', section, 'all.pdf', 1);

    expect(suggestAccount(storage, key, section, accounts)).toBe('a2');
    rememberAccount(storage, key, 'a1');
    expect(suggestAccount(storage, key, section, accounts)).toBe('a1');
    const other = { account: '9999' } as Section;
    expect(
      suggestAccount(storage, statementKey('sync-1', other, 'all.pdf', 2), other, accounts),
    ).toBe('');
  });

  it('forgets a remembered account that no longer exists', () => {
    const storage = store();
    const key = statementKey('sync-1', section, 'all.pdf', 1);
    rememberAccount(storage, key, 'gone');

    expect(suggestAccount(storage, key, section, accounts)).toBe('a2');
  });

  it('keys an account without digits by file and position', () => {
    expect(statementKey('s', {} as Section, 'a.csv', 2)).toBe('s|a.csv#2');
  });
});
