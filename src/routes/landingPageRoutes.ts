import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { listLandingPages, getLandingPage, createLandingPage, updateLandingPage, deleteLandingPage, getLandingAnalytics, getLandingVisitDetails } from '../controllers/LandingPageController';
import { downloadLandingDistZip } from '../controllers/LandingDistController';

const router = Router();

router.use(authenticateToken);

router.get('/', requirePermission('route:marketing'), listLandingPages);
router.get('/:id', requirePermission('route:marketing'), getLandingPage);
router.get('/:id/analytics', requirePermission('route:marketing'), getLandingAnalytics);
router.get('/:id/details/visits', requirePermission('route:marketing'), getLandingVisitDetails);
router.get('/:id/dist', requirePermission('action:marketing_manage'), downloadLandingDistZip);
router.post('/', requirePermission('action:marketing_manage'), createLandingPage);
router.put('/:id', requirePermission('action:marketing_manage'), updateLandingPage);
router.delete('/:id', requirePermission('action:marketing_manage'), deleteLandingPage);

export default router;
