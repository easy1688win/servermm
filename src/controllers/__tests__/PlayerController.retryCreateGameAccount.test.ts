process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

jest.mock('../../services/AuditService', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));

const mockPlayerFindByPk = jest.fn();
const mockGameFindOne = jest.fn();

jest.mock('../../models', () => ({
  Player: { findByPk: (...args: any[]) => mockPlayerFindByPk(...args) },
  Game: { findOne: (...args: any[]) => mockGameFindOne(...args) },
  Product: {},
  BankCatalog: {},
  Setting: {},
  User: {},
  PlayerStats: {},
}));

const mockGetServiceByProviderCode = jest.fn();
jest.mock('../../services/vendor/VendorFactory', () => ({
  VendorFactory: { getServiceByProviderCode: (...args: any[]) => mockGetServiceByProviderCode(...args) },
}));

import { retryCreateGameAccount } from '../PlayerController';

const makeRes = () => {
  const res: any = {};
  res.statusCode = 200;
  res.body = null;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    return res;
  };
  return res;
};

describe('retryCreateGameAccount', () => {
  beforeEach(() => {
    mockPlayerFindByPk.mockReset();
    mockGameFindOne.mockReset();
    mockGetServiceByProviderCode.mockReset();
  });

  test('recovers when vendor reports EXISTS and returns 200', async () => {
    const player: any = {
      id: 6,
      player_game_id: 'JK9900006',
      metadata: { gameAccounts: [] },
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockPlayerFindByPk.mockResolvedValue(player);
    mockGameFindOne.mockResolvedValue({
      id: 2,
      name: 'JOKER',
      status: 'active',
      use_api: true,
      Product: { providerCode: 76 },
    });
    const vendor = {
      createPlayer: jest.fn().mockResolvedValue({ success: true, code: 'EXISTS', status: 'Exists' }),
      setPlayerPassword: jest.fn().mockResolvedValue({ success: true }),
    };
    mockGetServiceByProviderCode.mockResolvedValue(vendor);

    const req: any = {
      params: { id: '6' },
      body: { gameName: 'JOKER' },
      user: { id: 1 },
    };
    const res = makeRes();

    await retryCreateGameAccount(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.code).toBe(1);
    expect(res.body?.data?.gameAccount?.accountId).toBe('JK9900006');
    expect(res.body?.data?.idempotent).toBe(true);
    const ga = (player.metadata.gameAccounts || []).find((x: any) => x.gameName === 'JOKER');
    expect(ga?.accountId).toBe('JK9900006');
    expect(ga?.provisioningStatus).toBe('CREATED');
  });

  test('returns idempotent when already created in metadata', async () => {
    const player: any = {
      id: 6,
      player_game_id: 'JK9900006',
      metadata: { gameAccounts: [{ gameName: 'JOKER', accountId: 'JK9900006', provisioningStatus: 'CREATED' }] },
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockPlayerFindByPk.mockResolvedValue(player);

    const req: any = {
      params: { id: '6' },
      body: { gameName: 'JOKER' },
      user: { id: 1 },
    };
    const res = makeRes();

    await retryCreateGameAccount(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.code).toBe(1);
    expect(res.body?.data?.idempotent).toBe(true);
    expect(mockGetServiceByProviderCode).not.toHaveBeenCalled();
  });
});

