import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { sendSuccess, sendError } from '../utils/response';
import { uploadRateLimit } from '../middleware/rateLimit';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const getPublicBaseUrl = (req: any): string => {
  const raw = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  const proto = req.protocol || 'http';
  const host = req.get ? req.get('host') : '';
  return `${proto}://${host}`.replace(/\/+$/, '');
};

const getImageExt = (mimetype: string): string | null => {
  const mt = (mimetype || '').toLowerCase();
  if (mt === 'image/jpeg' || mt === 'image/jpg') return '.jpg';
  if (mt === 'image/png') return '.png';
  if (mt === 'image/webp') return '.webp';
  if (mt === 'image/gif') return '.gif';
  return null;
};

// IP Geolocation endpoint
router.post('/geolocation', 
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const { ips } = req.body;

      if (!Array.isArray(ips) || ips.length === 0) {
        sendError(res, 'Code321', 400);
        return;
      }

      // Validate IP format
      const validIps = ips.filter(ip => {
        // Basic IPv4/IPv6 validation
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        return ipv4Regex.test(ip) || ipv6Regex.test(ip);
      });

      if (validIps.length === 0) {
        sendSuccess(res, 'Code1', []);
        return;
      }

      // Filter out private IPs
      const privateIpRanges = [
        /^10\./,           // 10.0.0.0/8
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
        /^192\.168\./,     // 192.168.0.0/16
        /^127\./,          // 127.0.0.0/8
        /^169\.254\./,     // 169.254.0.0/16
        /^::1$/,           // IPv6 localhost
        /^fc00:/,          // IPv6 unique local
        /^fe80:/           // IPv6 link-local
      ];

      const publicIps = validIps.filter(ip => 
        !privateIpRanges.some((range: RegExp) => range.test(ip))
      );

      if (publicIps.length === 0) {
        sendSuccess(res, 'Code1', []);
        return;
      }

      // Prepare request for ip-api.com batch endpoint
      const requestBody = publicIps.map(ip => ({
        query: ip,
        fields: 'country,countryCode,city,status,message'
      }));

      // Make request to ip-api.com from backend
      const response = await fetch('http://ip-api.com/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        sendError(res, 'Code322', 500);
        return;
      }

      const results = await response.json();

      // Process results and map back to original IP order
      const locationData: Record<string, any> = {};
      publicIps.forEach((ip, index) => {
        const result = results[index];
        
        if (result && result.status === 'success' && result.country) {
          const locationInfo = result.city 
            ? `${result.city}, ${result.country} (${result.countryCode})`
            : `${result.country} (${result.countryCode})`;
          locationData[ip] = {
            status: 'success',
            data: locationInfo
          };
        } else {
          locationData[ip] = {
            status: 'failed',
            data: null,
            message: result?.message || 'Unknown error'
          };
        }
      });

      // Return results in the same order as input
      const finalResults = ips.map(ip => {
        if (locationData[ip]) {
          return locationData[ip];
        }
        // For private IPs or invalid IPs
        return {
          status: 'failed',
          data: null,
          message: 'Private or invalid IP'
        };
      });

      sendSuccess(res, 'Code1', finalResults);
    } catch (error) {
      sendError(res, 'Code603', 500);
    }
  }
);

router.post(
  '/upload-image',
  authenticateToken,
  requirePermission('action:marketing_manage'),
  uploadRateLimit,
  upload.single('file'),
  async (req: AuthRequest, res) => {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        sendError(res, 'Code323', 400);
        return;
      }

      const ext = getImageExt(file.mimetype);
      if (!ext) {
        sendError(res, 'Code324', 400);
        return;
      }

      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const dir = path.resolve(process.cwd(), 'uploads', 'landing-images', ym);
      fs.mkdirSync(dir, { recursive: true });

      const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      const fullPath = path.join(dir, filename);
      fs.writeFileSync(fullPath, file.buffer);

      const base = getPublicBaseUrl(req);
      const url = `${base}/uploads/landing-images/${ym}/${filename}`;
      sendSuccess(res, 'Code1', { url });
    } catch {
      sendError(res, 'Code325', 500);
    }
  }
);

export default router;
