import { Router } from 'express';
import { getTransactions, getTransactionsContext, createTransaction, voidTransaction, failTransaction, getPlayerTransactionHistory, updateTransaction } from '../controllers/TransactionController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permission';

const router = Router();

router.use(authenticateToken);

router.get('/context', requirePermission('route:transactions'), getTransactionsContext);
router.get('/', requirePermission('route:transactions'), getTransactions);
router.get('/history', requirePermission('route:transaction_history'), getPlayerTransactionHistory);
router.post('/', requireAnyPermission(['action:deposit_create', 'action:withdrawal_create', 'action:burn_create']), createTransaction);
router.put('/:id', requirePermission('action:transaction_edit'), updateTransaction);
router.post('/:id/void', requirePermission('action:transaction_edit'), voidTransaction);
router.post('/:id/fail', requirePermission('route:transaction_history'), failTransaction);

export default router;
