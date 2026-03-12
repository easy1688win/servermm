import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';

const router = Router();

// IP Geolocation endpoint
router.post('/geolocation', 
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const { ips } = req.body;

      if (!Array.isArray(ips) || ips.length === 0) {
        return res.status(400).json({ message: 'Invalid IP addresses' });
      }

      // Validate IP format
      const validIps = ips.filter(ip => {
        // Basic IPv4/IPv6 validation
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        return ipv4Regex.test(ip) || ipv6Regex.test(ip);
      });

      if (validIps.length === 0) {
        return res.json([]);
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
        return res.json([]);
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
        return res.status(500).json({ message: 'Failed to fetch IP geolocation data' });
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

      res.json(finalResults);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

export default router;
