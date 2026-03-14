import { Router } from 'express';
import { getBankAccounts, createBankAccount, updateBankAccount, adjustBalance, deleteBankAccount, getBankActivity, getBankContext } from '../controllers/BankAccountController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';

const router = Router();

router.use(authenticateToken);

router.get('/', requirePermission('route:banks'), getBankAccounts);
router.get('/context', requirePermission('route:banks'), getBankContext);
router.get('/:id/activity', requirePermission('view:bank_balance'), getBankActivity);
router.post('/', requirePermission('action:bank_create'), createBankAccount);
router.put('/:id', requirePermission('action:bank_edit'), updateBankAccount);
router.post('/:id/adjust', requirePermission('action:bank_adjust'), adjustBalance);
router.delete('/:id', requirePermission('action:bank_delete'), deleteBankAccount);

export default router;
