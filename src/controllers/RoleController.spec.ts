import { createRole, deleteRole, updateRole } from "./RoleController";

jest.mock("../models", () => ({
  Role: {
    create: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
  Permission: {
    findAll: jest.fn(),
  },
  User: {
    findByPk: jest.fn(),
  },
}));

jest.mock("../services/AuditService", () => ({
  logAudit: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

jest.mock("../services/CacheService", () => ({
  flushCache: jest.fn(),
}));

const sendSuccess = jest.fn();
const sendError = jest.fn();

jest.mock("../utils/response", () => ({
  sendSuccess: (...args: any[]) => sendSuccess(...args),
  sendError: (...args: any[]) => sendError(...args),
}));

const getRes = () =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as any;

describe("RoleController system role protections", () => {
  beforeEach(() => {
    sendSuccess.mockReset();
    sendError.mockReset();
    const { Role, Permission } = require("../models");
    Role.create.mockReset();
    Role.findByPk.mockReset();
    Permission.findAll.mockReset();
  });

  test("createRole rejects reserved system role name Viewer", async () => {
    const req = { body: { name: "Viewer", description: "x", permissions: [] }, user: { id: 1 } } as any;
    const res = getRes();
    await createRole(req, res);
    expect(sendError).toHaveBeenCalledWith(res, "Code1112", 403);
  });

  test("updateRole rejects name/description changes for system role", async () => {
    const { Role } = require("../models");
    Role.findByPk.mockResolvedValue({
      id: 3,
      name: "Staff",
      description: "Read-only access",
      isSystem: true,
      Permissions: [],
      update: jest.fn(),
      setPermissions: jest.fn(),
      toJSON: jest.fn(() => ({})),
    });
    const req = { params: { id: "3" }, body: { name: "NewName" }, user: { id: 1 } } as any;
    const res = getRes();
    await updateRole(req, res);
    expect(sendError).toHaveBeenCalledWith(res, "Code1111", 403);
  });

  test("deleteRole rejects deleting system role", async () => {
    const { Role } = require("../models");
    Role.findByPk.mockResolvedValue({ id: 1, isSystem: true, name: "Super Admin" });
    const req = { params: { id: "1" }, user: { id: 1 } } as any;
    const res = getRes();
    await deleteRole(req, res);
    expect(sendError).toHaveBeenCalledWith(res, "Code1108", 403);
  });

  test("deleteRole rejects deleting protected role name even if isSystem is false", async () => {
    const { Role } = require("../models");
    Role.findByPk.mockResolvedValue({ id: 2, isSystem: false, name: "Operator" });
    const req = { params: { id: "2" }, user: { id: 1 } } as any;
    const res = getRes();
    await deleteRole(req, res);
    expect(sendError).toHaveBeenCalledWith(res, "Code1108", 403);
  });
});
