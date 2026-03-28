import { __test__ } from '../GameController';

describe('GameController vendor_config normalization', () => {
  test('returns null for null/undefined', () => {
    expect(__test__.normalizeVendorConfigRaw(null)).toBeNull();
    expect(__test__.normalizeVendorConfigRaw(undefined)).toBeNull();
  });

  test('returns object for object', () => {
    expect(__test__.normalizeVendorConfigRaw({ appId: 'x' })).toEqual({ appId: 'x' });
  });

  test('parses JSON object string', () => {
    const out = __test__.normalizeVendorConfigRaw('{"appId":"888","apiUrl":"https://x"}');
    expect(out).toEqual({ appId: '888', apiUrl: 'https://x' });
  });

  test('returns null for invalid JSON string', () => {
    expect(__test__.normalizeVendorConfigRaw('{bad')).toBeNull();
  });

  test('returns null for JSON array string', () => {
    expect(__test__.normalizeVendorConfigRaw('["a"]')).toBeNull();
  });
});

