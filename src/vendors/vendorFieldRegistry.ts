export type VendorFieldType = 'text' | 'password' | 'url' | 'number';

export type VendorFieldDef = {
  key: string;
  label: string;
  type: VendorFieldType;
  secret: boolean;
};

export const VENDOR_FIELDS: VendorFieldDef[] = [
  { key: 'brandName', label: 'Brand name', type: 'text', secret: false },
  { key: 'secretKey', label: 'Secret Key', type: 'password', secret: true },
  { key: 'authCode', label: 'Authcode', type: 'password', secret: true },
  { key: 'apiUrl', label: 'ApiUrl', type: 'url', secret: false },
  { key: 'appId', label: 'AppID', type: 'text', secret: false },
  { key: 'signatureKey', label: 'SignatureKey', type: 'password', secret: true },
  { key: 'merchantCode', label: 'Merchant Code', type: 'text', secret: false },
  { key: 'merchantId', label: 'Merchant ID', type: 'text', secret: false },
  { key: 'clientId', label: 'Client ID', type: 'text', secret: false },
  { key: 'clientSecret', label: 'Client Secret', type: 'password', secret: true },
  { key: 'apiKey', label: 'Api Key', type: 'password', secret: true },
  { key: 'apiSecret', label: 'Api Secret', type: 'password', secret: true },
  { key: 'token', label: 'Token', type: 'password', secret: true },
  { key: 'username', label: 'Username', type: 'text', secret: false },
  { key: 'password', label: 'Password', type: 'password', secret: true },
];

export const vendorFieldByKey: Record<string, VendorFieldDef> = Object.fromEntries(
  VENDOR_FIELDS.map((f) => [f.key, f]),
) as Record<string, VendorFieldDef>;

export const isAllowedVendorFieldKey = (key: string): boolean => {
  return Boolean(vendorFieldByKey[key]);
};

export const getVendorFieldDefsFromKeys = (keys: string[]): VendorFieldDef[] => {
  const out: VendorFieldDef[] = [];
  for (const k of keys) {
    const def = vendorFieldByKey[k];
    if (!def) continue;
    out.push(def);
  }
  return out;
};
