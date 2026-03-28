process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

jest.mock('../../services/AuditService', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));

const mockPlayerFindOne = jest.fn();
const mockPlayerCreate = jest.fn();
const mockGameFindAll = jest.fn();

jest.mock('../../models', () => ({
  Player: {
    findOne: (...args: any[]) => mockPlayerFindOne(...args),
    create: (...args: any[]) => mockPlayerCreate(...args),
  },
  Game: { findAll: (...args: any[]) => mockGameFindAll(...args) },
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

import { createPlayer } from '../PlayerController';

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

describe('createPlayer vendor EXISTS', () => {
  beforeEach(() => {
    mockPlayerFindOne.mockReset();
    mockPlayerCreate.mockReset();
    mockGameFindAll.mockReset();
    mockGetServiceByProviderCode.mockReset();
  });

  test('treats vendor EXISTS as recovered success and does not set SKIPPED_CONFLICT', async () => {
    mockPlayerFindOne.mockResolvedValue(null);

    const apiGame = { id: 2, name: 'JOKER', use_api: true, Product: { providerCode: 76 } };
    const nonApiGames: any[] = [];
    mockGameFindAll
      .mockResolvedValueOnce([apiGame])
      .mockResolvedValueOnce(nonApiGames);

    const vendor = {
      createPlayer: jest.fn().mockResolvedValue({ success: true, code: 'EXISTS', status: 'Exists' }),
      setPlayerPassword: jest.fn().mockResolvedValue({ success: true }),
    };
    mockGetServiceByProviderCode.mockResolvedValue(vendor);

    mockPlayerCreate.mockImplementation(async (payload: any) => ({
      ...payload,
      toJSON: () => payload,
    }));

    const req: any = {
      body: { player_game_id: 'JK9900008', game_id: null, tags: [], metadata: {} },
      user: { id: 1, permissions: ['action:player_create'] },
      ip: '127.0.0.1',
    };
    const res = makeRes();

    await createPlayer(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body?.code).toBe(1);
    expect(res.body?.data?.vendorCreateSkippedConflict).toBe(false);
    const vr = (res.body?.data?.vendorResults || []).find((r: any) => r.gameName === 'JOKER');
    expect(vr?.provisioningStatus).toBe('CREATED');
    expect(vr?.success).toBe(true);
  });
});
