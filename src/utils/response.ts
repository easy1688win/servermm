import { Response } from 'express';

type MessageCode = 1 | 2 | 3 | 4;

interface ApiResponseOptions {
  res: Response;
  code: MessageCode;
  key: string;
  httpStatus?: number;
  params?: Record<string, any>;
  data?: any;
  details?: any;
  traceId?: string;
}

export const sendResponse = ({
  res,
  code,
  key,
  httpStatus = 200,
  params = {},
  data,
  details,
  traceId,
}: ApiResponseOptions) => {
  res.status(httpStatus).json({
    code,
    key,
    http: httpStatus,
    params,
    ...(data !== undefined && { data }),
    ...(details !== undefined && { details }),
    ...(traceId !== undefined && { traceId }),
  });
};

export const sendSuccess = (res: Response, key: string, data?: any, params?: Record<string, any>, httpStatus = 200) => {
  sendResponse({ res, code: 1, key, httpStatus, params, data });
};

export const sendError = (res: Response, key: string, httpStatus = 400, details?: any, params?: Record<string, any>) => {
  sendResponse({ res, code: 2, key, httpStatus, params, details });
};

export const sendInfo = (res: Response, key: string, data?: any, params?: Record<string, any>, httpStatus = 200) => {
  sendResponse({ res, code: 3, key, httpStatus, params, data });
};

export const sendWarning = (res: Response, key: string, data?: any, params?: Record<string, any>, httpStatus = 200) => {
  sendResponse({ res, code: 4, key, httpStatus, params, data });
};
