import { describe, expect, it } from 'vitest';

import { lookupUserRule } from './merchants.js';
import { parseNarration } from './parse.js';
import { parseMerchantRules, rulesToJson } from './rules.js';

describe('parseMerchantRules', () => {
  it('reads rules from JSON text, case-insensitively', () => {
    const [rule] = parseMerchantRules(
      '[{ "pattern": "^acmestore", "name": "Acme Store" }]',
      'rules.json',
    );

    expect(rule?.name).toBe('Acme Store');
    expect(rule?.pattern.test('ACMESTOREPUNE')).toBe(true);
  });

  it('says where the text came from when it is not valid', () => {
    expect(() => parseMerchantRules('not json', 'my rules')).toThrow(
      /my rules is not valid JSON/,
    );
    expect(() => parseMerchantRules('{}', 'my rules')).toThrow(
      /must contain an array/,
    );
    expect(() => parseMerchantRules('[{"pattern":"("}]', 'my rules')).toThrow(
      /rule 1 needs a string "pattern"/,
    );
    expect(() =>
      parseMerchantRules('[{"pattern":"(","name":"X"}]', 'my rules'),
    ).toThrow(/invalid regular expression/);
  });

  it('writes rules back as JSON that parses to the same rules', () => {
    const text = rulesToJson([{ pattern: '^acmestore', name: 'Acme Store' }]);

    expect(parseMerchantRules(text, 'round trip')[0]?.name).toBe('Acme Store');
  });
});

describe('payee source and rule', () => {
  it('marks a built-in merchant as mapped', () => {
    expect(parseNarration('UPI-swiggy@ybl-412345678904-ORDER')).toMatchObject({
      source: 'merchant',
      merchant: 'Swiggy',
    });
  });

  it('marks a multi-word name as a name, and a bare VPA as a guess', () => {
    expect(
      parseNarration('UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA'),
    ).toMatchObject({ source: 'name', rule: '^acmestore' });
    expect(parseNarration('UPI/412345678903/9876543210@ybl/PAY')).toMatchObject(
      { source: 'vpa', rule: '^9876543210' },
    );
  });

  it('marks an account reference as a guess and keys it on the narration', () => {
    expect(
      parseNarration('IMPS/412345678905/0000000000000000@BANK000/PAYMENT'),
    ).toMatchObject({ source: 'account', rule: 'impsbankpayment' });
  });

  it('lets a rule written from the key name the payee', () => {
    const rules = parseMerchantRules(
      '[{ "pattern": "^9876543210", "name": "Neighbourhood Kirana" }]',
      'rules',
    );

    expect(
      parseNarration('UPI/412345678903/9876543210@ybl/PAY', {
        merchantRules: rules,
      }),
    ).toMatchObject({ merchant: 'Neighbourhood Kirana', source: 'merchant' });
  });

  it('lets a rule name a narration that has no name in it at all', () => {
    const rules = parseMerchantRules(
      '[{ "pattern": "impsbankpayment", "name": "Rent Payment" }]',
      'rules',
    );

    expect(
      parseNarration('IMPS/412345678905/0000000000000000@BANK000/PAYMENT', {
        merchantRules: rules,
      }),
    ).toMatchObject({ merchant: 'Rent Payment', source: 'merchant' });
  });

  it('does not let a user rule change a narration that already has a name', () => {
    const rules = parseMerchantRules(
      '[{ "pattern": "payment", "name": "Wrong" }]',
      'rules',
    );

    expect(
      parseNarration('UPI-JOHN DOE-johndoe@oksbi-412345678902-NA', {
        merchantRules: rules,
      }).merchant,
    ).toBe('John Doe');
  });
});

describe('lookupUserRule', () => {
  it('matches only the rules it is given, not the built-in map', () => {
    expect(lookupUserRule('swiggy', [])).toBeNull();
  });
});
