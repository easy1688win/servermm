import { Model, DataTypes } from 'sequelize';
import sequelize from '../config/database';
import { decrypt, encrypt, isEncrypted } from '../utils/encryption';

class AuditLog extends Model {
  public id!: number;
  public userId!: number | null; // Can be null for system actions or failed login attempts
  public action!: string;
  public original_data!: any;
  public new_data!: any;
  public ip_address!: string;
  public created_at!: Date;
}

AuditLog.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'user_id'
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  original_data: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
  },
  new_data: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
  },
  ip_address: {
      type: DataTypes.STRING(255),
      allowNull: true,
  }
}, {
  sequelize,
  modelName: 'AuditLog',
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false,
  createdAt: 'created_at',
  hooks: {
    beforeCreate: (instance: AuditLog) => {
      const serialize = (value: any): string => {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      if (instance.original_data != null) {
        const str = serialize(instance.original_data);
        instance.original_data = str && !isEncrypted(str) ? encrypt(str) : str;
      }

      if (instance.new_data != null) {
        const str = serialize(instance.new_data);
        instance.new_data = str && !isEncrypted(str) ? encrypt(str) : str;
      }

      if (instance.ip_address) {
        instance.ip_address = !isEncrypted(instance.ip_address)
          ? encrypt(instance.ip_address)
          : instance.ip_address;
      }
    },
    beforeUpdate: (instance: AuditLog) => {
      const serialize = (value: any): string => {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      if (instance.changed('original_data') && instance.original_data != null) {
        const str = serialize(instance.original_data);
        instance.original_data = str && !isEncrypted(str) ? encrypt(str) : str;
      }

      if (instance.changed('new_data') && instance.new_data != null) {
        const str = serialize(instance.new_data);
        instance.new_data = str && !isEncrypted(str) ? encrypt(str) : str;
      }

      if (instance.changed('ip_address') && instance.ip_address) {
        instance.ip_address = !isEncrypted(instance.ip_address)
          ? encrypt(instance.ip_address)
          : instance.ip_address;
      }
    },
    afterFind: (instances: AuditLog | AuditLog[] | null) => {
      if (!instances) return;

      const safeParseJson = (text: string): any => {
        const trimmed = text.trim();
        if (!trimmed) return null;
        if (trimmed === 'null') return null;
        if (trimmed === 'undefined') return null;
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          try {
            return JSON.parse(trimmed);
          } catch {
            return trimmed;
          }
        }
        return trimmed;
      };

      const decryptInstance = (inst: AuditLog) => {
        if (typeof (inst as any).original_data === 'string') {
          const raw = (inst as any).original_data as string;
          const decrypted = isEncrypted(raw) ? decrypt(raw) : raw;
          (inst as any).original_data = safeParseJson(decrypted);
        }

        if (typeof (inst as any).new_data === 'string') {
          const raw = (inst as any).new_data as string;
          const decrypted = isEncrypted(raw) ? decrypt(raw) : raw;
          (inst as any).new_data = safeParseJson(decrypted);
        }

        if (typeof (inst as any).ip_address === 'string') {
          const raw = (inst as any).ip_address as string;
          (inst as any).ip_address = isEncrypted(raw) ? decrypt(raw) : raw;
        }
      };

      if (Array.isArray(instances)) {
        instances.forEach(decryptInstance);
      } else {
        decryptInstance(instances);
      }
    },
  },
});

export default AuditLog;
