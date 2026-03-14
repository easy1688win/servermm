import { Router } from 'express';
import { Op } from 'sequelize';
import authRoutes from './authRoutes';
import bankAccountRoutes from './bankAccountRoutes';
import transactionRoutes from './transactionRoutes';
import playerRoutes from './playerRoutes';
import userRoutes from './userRoutes';
import roleRoutes from './roleRoutes';
import permissionRoutes from './permissionRoutes';
import gameRoutes from './gameRoutes';
import bankCatalogRoutes from './bankCatalogRoutes';
import settingRoutes from './settingRoutes';
import dashboardRoutes from './dashboardRoutes';
import utilityRoutes from './utilityRoutes';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permission';
import { getMaintenanceStatus } from '../middleware/maintenance';
import { AuditLog, User } from '../models';
import { decrypt, isEncrypted } from '../utils/encryption';

const router = Router();

router.use('/auth', authRoutes);
router.use('/bank-accounts', bankAccountRoutes);
router.use('/transactions', transactionRoutes);
router.use('/players', playerRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/permissions', permissionRoutes);
router.use('/games', gameRoutes);
router.use('/bank-catalog', bankCatalogRoutes);
router.use('/settings', settingRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/utility', utilityRoutes);

router.get('/maintenance', getMaintenanceStatus);

router.get(
  '/audit-logs',
  authenticateToken,
  requirePermission('route:audit'),
  async (req: AuthRequest, res) => {
	try {
		const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

		// Helper to parse "yyyy-MM-dd HH:mm:ss" as GMT+8
		const parseDateParam = (val: string) => {
			let s = val.trim();
			// If it looks like "yyyy-MM-dd HH:mm:ss", treat as GMT+8
			if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
				s = s.replace(' ', 'T') + '+08:00';
			}
			return new Date(s);
		};

		let where: any = {};
		if (startDate || endDate) {
			const start = startDate ? parseDateParam(startDate) : null;
			const end = endDate ? parseDateParam(endDate) : null;

			if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime()))) {
				return res.status(400).json({ message: 'Invalid date range' });
			}

			if (start && end) {
				where.created_at = {
					[Op.between]: [start, end],
				};
			} else if (start) {
				where.created_at = {
					[Op.gte]: start,
				};
			} else if (end) {
				where.created_at = {
					[Op.lte]: end,
				};
			}
		}

		const user = req.user;
		const permissions = (user?.permissions || []) as string[];
		const canViewAll = permissions.includes('view:audit_logs');
		const canViewSensitive = permissions.includes('view:sensitive_logs');
		const canViewUsers = permissions.includes('action:user_view');

		if (!canViewAll && user) {
			where.userId = user.id;
		}

		const [logs, allOperators] = await Promise.all([
			AuditLog.findAll({
				where: Object.keys(where).length > 0 ? where : undefined,
				attributes: ['id', 'userId', 'action', 'original_data', 'new_data', 'ip_address', 'created_at'],
				include: [
					{
						model: User,
						attributes: ['id', 'username', 'full_name'],
					},
				],
				order: [['created_at', 'DESC']],
			}),
			canViewUsers ? User.findAll({
				attributes: ['id', 'username', 'full_name'],
				where: { status: 'active' },
				order: [['username', 'ASC']],
			}) : Promise.resolve([])
		]);

		const payload = logs.map((log: any) => ({
			id: log.id,
			userId: log.userId ?? null,
			action: log.action,
			original_data: canViewSensitive ? log.original_data : null,
			new_data: canViewSensitive ? log.new_data : null,
			ip_address: canViewSensitive ? (log.ip_address ?? null) : null,
			created_at: log.created_at,
			User: log.User
				? {
						id: log.User.id,
						username: log.User.username,
						full_name: (() => {
							const raw = (log.User as any).full_name;
							if (typeof raw === 'string' && raw.trim().length > 0) {
								if (isEncrypted(raw)) {
									const decrypted = decrypt(raw);
									return decrypted !== raw ? decrypted : log.User.username;
								}
								return raw;
							}
							return null;
						})(),
				  }
				: null,
		}));

		let operatorOptions: any[] = [];
		if (canViewUsers) {
			operatorOptions = (allOperators as any[])
				.map((u) => {
					const rawFullName =
						typeof u.full_name === 'string' && u.full_name.trim().length > 0
							? u.full_name.trim()
							: null;
					let name = rawFullName || u.username;
					
					if (rawFullName && isEncrypted(rawFullName)) {
						const decrypted = decrypt(rawFullName);
						if (decrypted !== rawFullName) {
							name = decrypted;
						} else {
							// If decryption failed, fallback to username
							name = u.username;
						}
					}
					
					return name ? { id: u.id, name } : null;
				})
				.filter(Boolean);
		} else if (user) {
			const rawFullName = typeof user.full_name === 'string' ? user.full_name : null;
			let name = rawFullName || user.username;
			
			if (rawFullName && isEncrypted(rawFullName)) {
				const decrypted = decrypt(rawFullName);
				if (decrypted !== rawFullName) {
					name = decrypted;
				} else {
					name = user.username;
				}
			}
			
			if (name) {
				operatorOptions = [{ id: user.id, name }];
			}
		}

		res.json({
			logs: payload,
			operatorOptions
		});
	} catch (error) {
		res.status(500).json({ message: 'Failed to fetch audit logs' });
	}
  }
);

export default router;
